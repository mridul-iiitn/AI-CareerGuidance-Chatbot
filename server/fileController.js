const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
// Re-introducing LangChain GoogleGenerativeAIEmbeddings for embedding generation as requested.
const { GoogleGenerativeAIEmbeddings } = require("@langchain/google-genai");
const prisma = require("./config/db.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

// ------------------ Global In-Memory Structures -------------------
// Lightweight BM25 inverted index (rebuilt after ingestion or on first query)
let BM25_INDEX = null; // { N, avgdl, docStats: { [id]: { tf: {term:count}, dl } }, df: { term: docFreq } }
// Cache of profile boosting weights per conversation (optional minor optimization)
const PROFILE_CACHE = new Map();

// Domain configuration (used for boosting + query expansion)
const DOMAIN_CONFIG = {
  engineering: {
    streamKeys: ["engineering"],
    keywords: ["engineering", "b.tech", "btech", "mechanical", "civil", "electrical", "computer science", "software", "it"],
    expansions: [
      "jee", "jee main", "jee advanced", "bitsat", "viteee", "srmjeee", "comedk", "mht cet", "wbjee", "keam",
      "engineering colleges", "entrance exam", "b.tech", "engineering degree"
    ]
  },
  commerce: { streamKeys: ["commerce"], keywords: ["commerce","b.com","account","finance","marketing"], expansions: [] },
  law: { streamKeys: ["law"], keywords: ["law","llb","legal","clat"], expansions: [] },
  medical: { streamKeys: ["medical"], keywords: ["medical","mbbs","doctor","neet"], expansions: [] },
  humanities: { streamKeys: ["arts_humanities"], keywords: ["humanities","arts","philosophy","psychology","sociology"], expansions: [] }
};

function detectDomainTerm(questionLower) {
  for (const [domain, cfg] of Object.entries(DOMAIN_CONFIG)) {
    if (cfg.keywords.some(k => questionLower.includes(k))) return domain;
  }
  return null;
}

const embeddingModel = new GoogleGenerativeAIEmbeddings({
  model: "models/embedding-001",
  apiKey: process.env.GEMINI_API_KEY,
});

async function embedTexts(texts) {
  // LangChain client already batches internally when needed.
  return embeddingModel.embedDocuments(texts);
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const vectorToBytes = (vector) => Buffer.from(new Float32Array(vector).buffer);
const bytesToVector = (bytes) => Array.from(new Float32Array(bytes));
const l2Norm = (vec) => Math.sqrt(vec.reduce((s, v) => s + v * v, 0));

// Basic keyword extraction (TF scoring) for hybrid lexical filtering.
function extractKeywords(text, k = 8) {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const stop = new Set(["the","and","is","to","of","in","a","for","on","with","by","or","be","as","at","from","an","are","that","this","it","into","about","can","will","their"]);
  const freq = {};
  cleaned.split(/\s+/).filter(Boolean).forEach(w => { if(!stop.has(w) && w.length > 2) freq[w] = (freq[w]||0)+1; });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,k).map(e=>e[0]).join(",");
}

// ------------------ BM25 & Hybrid Retrieval Helpers ------------------
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function buildBM25Index(docs) {
  const df = {}; // document frequency
  const docStats = {}; // per doc term frequencies
  let totalLength = 0;
  for (const d of docs) {
    const terms = tokenize(d.content);
    totalLength += terms.length;
    const tf = {};
    terms.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    docStats[d.id] = { tf, dl: terms.length };
    const seen = new Set();
    for (const t of terms) {
      if (!seen.has(t)) {
        df[t] = (df[t] || 0) + 1;
        seen.add(t);
      }
    }
  }
  return { N: docs.length, avgdl: totalLength / Math.max(1, docs.length), docStats, df };
}

function bm25Score(queryTerms, docId) {
  if (!BM25_INDEX) return 0;
  const { N, avgdl, docStats, df } = BM25_INDEX;
  const k1 = 1.35, b = 0.72;
  const stats = docStats[docId];
  if (!stats) return 0;
  let score = 0;
  for (const term of queryTerms) {
    const f = stats.tf[term] || 0;
    if (!f) continue;
    const n = df[term] || 0;
    const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    const denom = f + k1 * (1 - b + b * (stats.dl / avgdl));
    score += idf * ((f * (k1 + 1)) / denom);
  }
  return score;
}

function ensureBM25Index(docs) {
  if (!BM25_INDEX || (BM25_INDEX.N || 0) !== docs.length) {
    BM25_INDEX = buildBM25Index(docs);
  }
}

// ------------------ Conversation State & Profile Inference ------------------
async function getOrInitConversationState(conversationId) {
  if (!conversationId) return null;
  let state = await prisma.conversationState.findUnique({ where: { conversationId } });
  if (!state) {
    state = await prisma.conversationState.create({ data: { conversationId } });
  }
  return state;
}

async function safeGetOrInitConversationState(conversationId) {
  try {
    return await getOrInitConversationState(conversationId);
  } catch (e) {
    console.warn("ConversationState table access failed (maybe migration not applied):", e.message);
    return null; // graceful degradation
  }
}

function inferProfileSignals(question, historyTexts = []) {
  const text = (historyTexts.join(" \n") + " " + question).toLowerCase();
  const signals = { analytical: 0, people: 0, creative: 0, operational: 0 };
  const inc = (k, v = 1) => { signals[k] += v; };
  const analyticalWords = ['data','analysis','research','finance','statistics','logic'];
  const peopleWords = ['team','leadership','helping','counseling','community','client'];
  const creativeWords = ['design','creative','writing','art','media','fashion','content'];
  const operationalWords = ['process','management','operations','logistics','plan','organize'];
  analyticalWords.forEach(w=> { if (text.includes(w)) inc('analytical'); });
  peopleWords.forEach(w=> { if (text.includes(w)) inc('people'); });
  creativeWords.forEach(w=> { if (text.includes(w)) inc('creative'); });
  operationalWords.forEach(w=> { if (text.includes(w)) inc('operational'); });
  // Determine top profile (if any meaningful signal)
  const entries = Object.entries(signals).sort((a,b)=> b[1]-a[1]);
  const top = entries[0];
  const profileType = top && top[1] > 0 ? top[0] : null;
  return { profileType, signals };
}

function computeProfileBoost(doc, profileType) {
  if (!profileType) return 0;
  const content = doc.content.toLowerCase();
  const profileKeywords = {
    analytical: ['analysis','data','quantitative','research','statistics','finance'],
    people: ['team','collaborative','counsel','community','client','communication','leadership'],
    creative: ['design','creative','innovation','media','art','fashion','content','ux','ui'],
    operational: ['process','operations','logistics','supply','manage','planning']
  };
  const kws = profileKeywords[profileType] || [];
  let hits = 0;
  kws.forEach(k => { if (content.includes(k)) hits++; });
  return Math.min(0.12, hits * 0.02); // bounded boost
}

async function updateConversationState(conversationId, updates) {
  if (!conversationId) return;
  await prisma.conversationState.update({ where: { conversationId }, data: updates });
  // Invalidate cache
  PROFILE_CACHE.delete(conversationId);
}

// ------------------ Answer Verification ------------------
async function verifyAnswer({ model, answer, context, question }) {
  try {
    const prompt = `You are a verification layer. Given the question, proposed answer, and context chunks, do a factual alignment check. 
Return JSON with keys: { valid: boolean, issues: string[], improved_answer: string }.
Rules: Mark invalid if answer invents exams, degrees, or pathways not present in context. If valid but can be made more concise or can cite references (numbers) add improved version.`;
    const result = await model.generateContent(`${prompt}\nQUESTION: ${question}\nANSWER: ${answer}\nCONTEXT:\n${context.slice(0, 6000)}`);
    const raw = result.response.text();
    let parsed = null;
    try { parsed = JSON.parse(raw.replace(/```json|```/g,'')); } catch(e) {}
    if (!parsed || typeof parsed !== 'object') return { valid: true, answer, improved: null, issues: ['ParseFailed'] };
    return { valid: parsed.valid !== false, answer, improved: parsed.improved_answer || null, issues: parsed.issues || [] };
  } catch (e) {
    return { valid: true, answer, improved: null, issues: ['VerifierError'] };
  }
}

// Heuristic section title detector: first line or all-caps line preceding content.
function detectSectionTitles(rawText) {
  const lines = rawText.split(/\n+/);
  const titles = new Set();
  lines.forEach((l, idx) => {
    const trimmed = l.trim();
    if (!trimmed) return;
    if (/^[A-Z][A-Z\s/&-]{3,}$/.test(trimmed) && trimmed.length < 80) {
      titles.add(trimmed);
    }
    // Bold style markers not present in raw, so rely on caps.
  });
  return titles;
}

// Advanced semantic-aware chunking.
function advancedChunk(rawText, opts = {}) {
  const {
    maxTokens = 380, // approximate: we treat 1 token ~ 0.75 words; keep short.
    overlapTokens = 40,
    minChunkChars = 180,
  } = opts;
  // Normalize line breaks.
  const clean = rawText.replace(/\r/g, "").replace(/\t/g, " ").replace(/ +/g, " ");
  // Split into paragraphs/sections.
  const blocks = clean.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const titles = detectSectionTitles(rawText);
  const chunks = [];
  let buffer = [];
  let tokenEstimate = 0;
  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join("\n").trim();
    if (text.length < minChunkChars) { buffer = []; tokenEstimate = 0; return; }
    chunks.push(text);
    // Rolling overlap: keep tail part for next context bridging.
    const words = text.split(/\s+/);
    buffer = words.slice(Math.max(0, words.length - overlapTokens));
    tokenEstimate = buffer.length;
  };
  for (const block of blocks) {
    const words = block.split(/\s+/);
    const isTitle = titles.has(block.trim());
    if (isTitle && buffer.length) {
      flush();
      buffer = [block];
      tokenEstimate = words.length;
      continue;
    }
    if (tokenEstimate + words.length > maxTokens) flush();
    buffer.push(block);
    tokenEstimate += words.length;
  }
  flush();
  return chunks;
}

// Helper: Create embedding from PDF and save to database
const createEmbeddingFromPDF = async (req, res) => {
  try {
    const pdfsDirectory = path.join(__dirname, "./pdfs");
    console.log(`Looking for PDFs in: ${pdfsDirectory}`);

    const pdfFiles = fs.readdirSync(pdfsDirectory)
      .filter(file => file.toLowerCase().endsWith('.pdf'));

    if (pdfFiles.length === 0) {
      return res.status(404).json({ error: "No PDF files found in the ./pdfs directory" });
    }

    console.log(`Found ${pdfFiles.length} PDF files to process:`, pdfFiles);

    const processed = []; // {file, chunks, tokens}
    const skipped = [];   // {file, reason, extractedChars}

    await prisma.document.deleteMany({});
    console.log("Cleared existing documents from the database.");

    for (const pdfFile of pdfFiles) {
      const filePath = path.join(pdfsDirectory, pdfFile);
      console.log(`--- Processing ${pdfFile} ---`);

      let pdfData;
      try {
        const fileBuffer = fs.readFileSync(filePath);
        pdfData = await pdfParse(fileBuffer);
      } catch (e) {
        console.warn(`Failed to parse ${pdfFile}:`, e.message);
        skipped.push({ file: pdfFile, reason: 'parse_error', extractedChars: 0 });
        continue;
      }

      const raw = (pdfData.text || '').trim();
      if (!raw) {
        console.warn(`Skipping ${pdfFile} (no extractable text) – likely scanned / needs OCR.`);
        skipped.push({ file: pdfFile, reason: 'no_text', extractedChars: 0 });
        continue;
      }
      if (raw.length < 120) {
        console.warn(`Skipping ${pdfFile} (very little text: ${raw.length} chars) – likely scanned or decorative.`);
        skipped.push({ file: pdfFile, reason: 'too_short', extractedChars: raw.length });
        continue;
      }

      let chunks = advancedChunk(raw, { maxTokens: 420, overlapTokens: 50 });
      const refined = [];
      for (const c of chunks) {
        const wordCount = c.split(/\s+/).length;
        if (wordCount > 600) {
          const mid = Math.floor(wordCount/2);
            const words = c.split(/\s+/);
            refined.push(words.slice(0, mid+50).join(" "));
            refined.push(words.slice(mid-50).join(" "));
        } else {
          refined.push(c);
        }
      }
      chunks = refined;
      console.log(`Advanced split produced ${chunks.length} chunks for ${pdfFile}.`);

      let embeddings;
      try {
        embeddings = await embedTexts(chunks);
      } catch (e) {
        console.warn(`Embedding generation failed for ${pdfFile}:`, e.message);
        skipped.push({ file: pdfFile, reason: 'embedding_error', extractedChars: raw.length });
        continue;
      }

      let tokenAggregate = 0;
      for (let i = 0; i < chunks.length; i++) {
        const emb = embeddings[i];
        if (!emb) continue;
        const content = chunks[i];
        tokenAggregate += content.split(/\s+/).length;
        const taxonomy = deriveTaxonomy(content);
        await prisma.document.create({
          data: {
            content,
            embedding: vectorToBytes(emb),
            sourceFile: pdfFile,
            chunkIndex: i,
            sectionTitle: extractProbableTitle(content),
            tokenCount: content.split(/\s+/).length,
            keywords: extractKeywords(content),
            embeddingNorm: l2Norm(emb),
            stream: taxonomy.stream,
            exams: JSON.stringify(taxonomy.exams),
            degrees: JSON.stringify(taxonomy.degrees),
            skills: JSON.stringify(taxonomy.skills)
          }
        });
      }
      processed.push({ file: pdfFile, chunks: chunks.length, tokens: tokenAggregate });
      console.log(`Saved ${chunks.length} chunks for ${pdfFile}.`);
    }

    const allDocs = await prisma.document.findMany();
    ensureBM25Index(allDocs);

    res.json({
      message: `Embedding pass complete.`,
      processed,
      skipped,
      totals: { processed: processed.length, skipped: skipped.length, documents: allDocs.length }
    });
  } catch (error) {
    console.error("DETAILED EMBEDDING ERROR:", error);
    res.status(500).json({ error: "Error creating embeddings" });
  }
};

//Helper : Query function to process user questions and generate responses
const query = async (req, res) => {
  try {
  const { question, isFollowUp, id: conversationIdFromRequest, userId, debug } = req.body;
    console.log("Received conversation id:", conversationIdFromRequest);
    console.log("Received user id:", userId);
    console.log("Received question:", question);
    console.log("Is follow-up:", isFollowUp);
    console.log("Received conversation id:", conversationIdFromRequest);
    console.log("Received user id:", userId);

    if (!question) {
      return res.status(400).json({ error: "Question is required" });
    }

  let currentConversation = null;
  let context = "";
  let referencesArray = [];
  let followUpQuestion = "";
  let previousContext = "";
  let lastAnswer = "";

    // If this is a follow-up question, retrieve the conversation
    if (isFollowUp && conversationIdFromRequest && conversationIdFromRequest !== "career-guidance-home") {
      currentConversation = await prisma.conversation.findUnique({
        where: { id: conversationIdFromRequest },
        include: { history: { orderBy: { createdAt: 'asc' } } },
      });

      if (currentConversation) {
        // Retrieve context only if conversation was found
        const lastHistory = currentConversation.history[currentConversation.history.length - 1];
        if (lastHistory) {
            previousContext = lastHistory.context;
            followUpQuestion = lastHistory.followUpQuestion;
            lastAnswer = lastHistory.answer;
        }
      }
    }
    // Intent & follow-up logic
  const cleanedQuestion = cleanQuery(question);
  const normalizedQ = cleanedQuestion.toLowerCase();
    let intent = "general";
    const negPatterns = /(not interested|don't want|do not want|no i am not|no i'm not|no,?\s*i am not|not into)/i;
    const sourcePattern = /(what are (the )?sources|source of|where (did|does) this (come|came) from|cite|citations?)/i;
    const affirmPatterns = /^(yes|yeah|yup|sure|okay|ok|please do|go ahead)\b/;
    if (sourcePattern.test(normalizedQ)) intent = "request_sources"; else if (negPatterns.test(normalizedQ)) intent = "negative_rejection"; else if (affirmPatterns.test(normalizedQ)) intent = "followup_accept";
    const domainKeywords = ["commerce","engineering","law","medical","hotel","hospitality","arts","humanities","science","management","design","mass communication","economics","social work","data","it"];
    if (domainKeywords.some(k => normalizedQ.includes(k))) {
      if (intent !== "negative_rejection" && intent !== "request_sources") intent = "domain_focus";
    }
  let questionToProcess = cleanedQuestion;
    if (intent === "followup_accept" && followUpQuestion) questionToProcess = followUpQuestion;

  // --- Domain detection + query expansion (internal retrieval only) ---
  const domainTerm = detectDomainTerm(normalizedQ); // e.g., 'engineering'
  let retrievalQuestion = questionToProcess;
  if (domainTerm && DOMAIN_CONFIG[domainTerm]?.expansions?.length) {
    retrievalQuestion += " " + DOMAIN_CONFIG[domainTerm].expansions.join(" ");
  }

  const [queryEmbedding] = await embedTexts([questionToProcess]);
  const documents = await prisma.document.findMany();
  ensureBM25Index(documents);

    if (documents.length === 0) {
      return res.status(404).json({ error: "No documents found" });
    }

    // Hybrid pre-filter: lexical keyword overlap + embedding similarity.
    const queryTerms = new Set(retrievalQuestion.toLowerCase().split(/\W+/).filter(w=>w.length>2));
    // Conversation state for profile boosting
    let conversationIdActive = conversationIdFromRequest;
    if (currentConversation) conversationIdActive = currentConversation.id;
    let convState = null;
    if (conversationIdActive && conversationIdActive !== 'career-guidance-home') {
      convState = await safeGetOrInitConversationState(conversationIdActive);
    }
    // Infer profile from recent history + current question
    let profileType = convState?.profileType || null;
    if (!profileType) {
      const recentTexts = (currentConversation?.history || []).slice(-6).map(h=> `${h.question} ${h.answer}`);
      const inferred = inferProfileSignals(questionToProcess, recentTexts);
      profileType = inferred.profileType;
      if (profileType && convState) {
        await updateConversationState(convState.conversationId, { profileType });
      }
    }
    const prelim = documents.map(doc => {
      const emb = bytesToVector(doc.embedding);
      const embNorm = doc.embeddingNorm || l2Norm(emb);
      const cos = cosineSimilarityPreNorm(queryEmbedding, emb, embNorm);
      const kw = (doc.keywords || "").split(",").filter(Boolean);
      const lexicalMatches = kw.reduce((c, k)=> c + (queryTerms.has(k)?1:0), 0);
      // BM25 sparse score
      const bm25 = bm25Score([...queryTerms], doc.id);
      // Profile boost
      const profileBoost = computeProfileBoost(doc, profileType);
      // Domain boost (stronger than profile if explicit domain requested)
      let domainBoost = 0;
      if (domainTerm) {
        const cfg = DOMAIN_CONFIG[domainTerm];
        const lc = doc.content.toLowerCase();
        if (cfg.streamKeys.includes(doc.stream)) domainBoost += 0.35; // taxonomy match
        if (cfg.keywords.some(k => lc.includes(k))) domainBoost += 0.20; // lexical content match
        domainBoost = Math.min(domainBoost, 0.45);
      }
      return { ...doc, _emb: emb, cos, lexicalMatches, bm25, profileBoost, domainBoost };
    });
    // Pick top N for rerank using combined score.
    // Score fusion: weighted sum of normalized components
    // First get maxima for normalization
    const maxCos = Math.max(...prelim.map(p=>p.cos || 0), 1e-6);
    const maxBM = Math.max(...prelim.map(p=>p.bm25 || 0), 1e-6);
    const hybridTop = prelim
      .map(p => {
        const densePart = (p.cos / maxCos) * 0.50; // slightly reduced to make room for domain boost
        const sparsePart = (p.bm25 / maxBM) * 0.27;
        const lexicalPart = (p.lexicalMatches) * 0.05;
        const profilePart = p.profileBoost; // already small (<=0.12)
        const domainPart = p.domainBoost || 0; // up to 0.45
        const fused = densePart + sparsePart + lexicalPart + profilePart + domainPart;
        return { ...p, fused };
      })
      .sort((a,b)=> b.fused - a.fused)
      .slice(0, 40);

    // Lightweight reranking & de-duplication
    const deduped = [];
    for (const cand of hybridTop) {
      const isDup = deduped.some(ex => cosineSimilarityPreNorm(cand._emb, ex._emb, l2Norm(ex._emb)) > 0.92);
      if (!isDup) deduped.push(cand);
    }
    const reranked = deduped
      .map(d => ({
        ...d,
        rerank: d.fused * (1 + d.lexicalMatches * 0.05) - Math.max(0, (d.tokenCount - 420))/1400
      }))
      .sort((a,b)=> b.rerank - a.rerank)
      .slice(0, 12);

    // Diversity constraint + ensure domain coverage fallback
    const perFileCount = {};
    let diversified = [];
    for (const d of reranked) {
      const key = d.sourceFile || 'unknown';
      perFileCount[key] = (perFileCount[key]||0)+1;
      if (perFileCount[key] <= 2) diversified.push(d);
      if (diversified.length >= 10) break;
    }

    // Domain fallback: if explicit domain requested but <3 chunks for it, run targeted selection
    if (domainTerm) {
      const domainChunks = diversified.filter(d => d.domainBoost > 0.1 || (d.stream && DOMAIN_CONFIG[domainTerm].streamKeys.includes(d.stream)));
      if (domainChunks.length < 3) {
        const additional = reranked.filter(d => !diversified.includes(d) && (d.domainBoost > 0.1 || (d.stream && DOMAIN_CONFIG[domainTerm].streamKeys.includes(d.stream))));
        for (const add of additional) {
          diversified.push(add);
          if (diversified.filter(x => x.domainBoost > 0.1 || (x.stream && DOMAIN_CONFIG[domainTerm].streamKeys.includes(x.stream))).length >= 3) break;
        }
      }
    }

    diversified = diversified.slice(0, 8);
    const topDocuments = diversified;

    // --- existing logic below remains unchanged ---
    context = topDocuments.map((doc) => doc.content).join("\n---\n");
    if (previousContext && isFollowUp) {
      context = `${previousContext}\n---\n${context}`;
    }

    referencesArray = topDocuments.map((doc, index) => ({
      reference_number: index + 1,
      source: doc.sourceFile || "unknown",
      score: Number(doc.rerank?.toFixed(4) || doc.fused?.toFixed(4) || doc.cos?.toFixed(4)),
      bm25: Number((doc.bm25||0).toFixed(3)),
      profileBoost: Number((doc.profileBoost||0).toFixed(3)),
      domainBoost: Number((doc.domainBoost||0).toFixed(3)),
      stream: doc.stream || null
    }));

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash", temperature: 0.65 });
  let answer = "";
  let generationError = null;
  try {
    if (intent === "request_sources") {
      const uniqueSources = [...new Set(referencesArray.map(r => r.source))];
      answer = `Sources for the last answer:\n` + uniqueSources.map(s => `• ${s}`).join("\n");
    } else if (intent === "negative_rejection") {
      answer = `Understood—you want to shift focus. Please name one or two interest areas so I can give targeted guidance (e.g., law, data, design, hospitality, economics, engineering).`;
    } else if (intent === "domain_focus") {
      const systemPrompt = `You are a precise career guidance assistant.\nRULES:\n1. Use ONLY supplied context.\n2. If info missing say: "I don't have sufficient information." (no extra speculation).\n3. Structure: Overview; Key Roles; Pathways & Entrance Exams; Core Skills; Practical Next Steps.\n4. Emphasize the requested domain (${domainTerm || 'domain'}) and ignore unrelated streams.\n5. Short, high-signal bullets. No fluff.\n6. End with ONE clarifying question if personalization incomplete.`;
      const result = await model.generateContent(`${systemPrompt}\nContext:\n${context}\nUser Question: ${questionToProcess}`);
      answer = result.response.text().trim();
    } else {
      const systemPrompt = `You are a precise career guidance assistant.\nRules: context-only answers; concise bullets; no hallucination; highlight actionable next steps; avoid repeating previous answer phrasing; one clarifying question at end if needed.`;
      const result = await model.generateContent(`${systemPrompt}\nContext:\n${context}\nUser Question: ${questionToProcess}`);
      answer = result.response.text().trim();
    }
  } catch (genErr) {
    generationError = genErr.message;
    console.error("Primary generation failed:", genErr);
    answer = "I'm temporarily unable to generate a detailed answer due to an internal error. Please try again shortly.";
  }

  // Follow-up generation
  try {
    if (intent === "request_sources") {
      followUpQuestion = "Need details on any specific domain? (e.g., law, engineering, design)";
    } else if (intent === "negative_rejection") {
      followUpQuestion = "Which 1–2 areas would you like to explore instead?";
    } else {
      const refsCompact = [...new Set(referencesArray.map(r => r.source))].slice(0,5).join(", ");
      const followUpPrompt = `Provide ONE short (<=18 words) follow-up that deepens the user's exploration without being yes/no. Sources: ${refsCompact}`;
      const followUpResult = await model.generateContent(followUpPrompt);
      followUpQuestion = followUpResult.response.text().trim();
    }
  } catch (fuErr) {
    console.warn("Follow-up generation failed:", fuErr.message);
    followUpQuestion = "Would you like to explore another domain or go deeper on this one?";
  }

    // If conversation exists, update its history, otherwise create a new conversation
  if (!currentConversation) {
        if (!userId) {
            return res.status(400).json({ error: "User ID is required for a new conversation." });
        }
        const newConversationId = conversationIdFromRequest || uuidv4();
        currentConversation = await prisma.conversation.create({
            data: {
                id: newConversationId,
                userId: userId,
                history: {
                    create: [
                        {
                            question,
                            answer,
                            context,
                            followUpQuestion,
                            references: JSON.stringify(referencesArray),
                        },
                    ],
                },
            },
        });
    } else {
      await prisma.conversationHistory.create({
        data: {
          question,
          answer,
          context,
          followUpQuestion,
          references: JSON.stringify(referencesArray),
          conversationId: currentConversation.id,
        },
      });
      // Update usage stats for retrieved documents
      for (const [idx, doc] of topDocuments.entries()) {
        await prisma.document.update({
          where: { id: doc.id },
          data: {
            usageCount: { increment: 1 },
            avgRank: doc.avgRank ? ((doc.avgRank * (doc.usageCount||1)) + (idx+1)) / ((doc.usageCount||1)+1) : (idx+1)
          }
        });
      }
    }

    // Answer verification second pass
    let verification = { valid: true, issues: ["skipped"], improved: null };
    try {
      const verifierModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash", temperature: 0 });
      verification = await verifyAnswer({ model: verifierModel, answer, context, question: questionToProcess });
    } catch (verErr) {
      console.warn("Verification step failed:", verErr.message);
    }

    let finalAnswer = answer;
    if (!verification.valid && verification.improved) {
      finalAnswer = verification.improved + "\n\n(Adjusted after verification)";
    } else if (verification.improved) {
      finalAnswer = verification.improved;
    }

    const baseResponse = {
      success: true,
      data: {
        answer: finalAnswer,
        follow_up: followUpQuestion,
        references: referencesArray,
        conversationId: currentConversation.id,
        profileType: profileType || null,
        verification: { issues: verification.issues, valid: verification.valid }
      }
    };
    if (debug) {
      baseResponse.debug = {
        intent,
        domainTerm,
        profileType,
        generationError,
        counts: { totalDocs: documents.length, prelim: prelim.length },
        topPreview: referencesArray.slice(0,3)
      };
    }
    return res.json(baseResponse);
  } catch (error) {
    console.error("Error processing query (outer catch):", error);
    return res.status(500).json({ error: "Error processing query", detail: error.message });
  }
};

// Backward compatibility wrapper (not used anymore but kept to avoid breaking imports if any).
function splitTextIntoChunks(text, maxLength = 1000) {
  return advancedChunk(text, { maxTokens: Math.floor(maxLength/2) });
}

function cosineSimilarityPreNorm(vecA, vecB, normB) {
  const dot = vecA.reduce((s,a,i)=> s + a*vecB[i], 0);
  const normA = l2Norm(vecA);
  return dot / (normA * normB);
}

function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (normA * normB);
}

function extractProbableTitle(chunk) {
  const firstLine = chunk.split(/\n/)[0].trim();
  if (/^[A-Z][A-Z\s/&-]{3,}$/.test(firstLine) && firstLine.length < 80) return firstLine;
  // fallback: take first 6 words
  return firstLine.split(/\s+/).slice(0,6).join(" ");
}

// Taxonomy derivation (rule-based quick pass)
function deriveTaxonomy(text) {
  const lower = text.toLowerCase();
  const streamMap = [
    { key: 'commerce', words: ['b.com','account','finance','marketing','business','commerce','economics'] },
    { key: 'law', words: ['llb','legal','law','advocate','juris'] },
    { key: 'engineering', words: ['engineering','b.tech','mechanical','civil','electrical','computer science'] },
    { key: 'medical', words: ['mbbs','medical','doctor','medicine','clinical','hospital'] },
    { key: 'hospitality', words: ['hotel management','hospitality','bhm'] },
    { key: 'arts_humanities', words: ['history','philosophy','sociology','psychology','humanities','liberal arts'] },
    { key: 'design', words: ['design','nift','fashion','creative','ux','ui'] },
    { key: 'media', words: ['mass communication','journalism','media','broadcast'] },
    { key: 'science', words: ['physics','chemistry','biology','mathematics','pure science'] }
  ];
  let stream = null;
  for (const s of streamMap) {
    if (s.words.some(w => lower.includes(w))) { stream = s.key; break; }
  }
  const exams = [];
  const examPatterns = [/neet/i,/jee/i,/clat/i,/gate/i,/cat /i,/nda /i,/ssc/i,/upsc/i,/nchm/i];
  examPatterns.forEach(r=>{ const m = text.match(r); if (m) exams.push(m[0].toUpperCase()); });
  const degrees = [];
  const degreePatterns = [/b\.com/i,/bba/i,/mba/i,/bsc/i,/b\.tech/i,/llb/i,/mbbs/i,/bhm/i];
  degreePatterns.forEach(r=>{ const m = text.match(r); if (m) degrees.push(m[0].toUpperCase()); });
  const skills = [];
  const skillWords = ['communication','analysis','problem-solving','leadership','teamwork','creativity','time management','financial','research'];
  skillWords.forEach(sw=>{ if (lower.includes(sw)) skills.push(sw); });
  return { stream, exams: [...new Set(exams)], degrees: [...new Set(degrees)], skills: [...new Set(skills)] };
}

// Basic query cleaner
function cleanQuery(q='') {
  return q.replace(/\s+/g,' ').replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
}

const fetchConversationHistory = async (req, res) => {
  try {
    const { conversationId } = req.params; 

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        message: "Conversation ID is required",
      });
    }

    console.log(`Fetching history for conversation ID: ${conversationId}...`);

    const conversationHistory = await prisma.conversationHistory.findMany({
      where: {
        conversationId: conversationId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (conversationHistory.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No conversation history found for this conversation",
      });
    }

    const latestMessage = conversationHistory[0];

    res.json({
      success: true,
      id: latestMessage.id, 
      conver: conversationId,
      latestMessage,
      history: conversationHistory,
    });

  } catch (error) {
    console.error("Error fetching conversation history:", error);
    res.status(500).json({ error: "Error fetching conversation history" });
  }
};

const fetchAllConversationsh = async (req, res) => {
  const {id} = req.body;
  try {
    console.log(`Fetching all conversations for user: ${id}...`);

    if (!id) {
        return res.status(400).json({ success: false, message: "User ID is required." });
    }

    const conversations = await prisma.conversation.findMany({
      where:{
        userId: id
      },
      orderBy: { createdAt: "desc" },
    });

    if (conversations.length === 0) {
      return res.json({
        success: false,
        message: "No conversations found",
      });
    }

    const conversationIds = conversations.map((conversation) => conversation.id);

    res.json({
      success: true,
      data: conversationIds,
    });

  } catch (error) {
    console.error("Error fetching conversation IDs:", error);
    res.status(500).json({ error: "Error fetching conversation IDs" });
  }
};

const conversationHistory = async (req, res) => {
  try {
    const { id } = req.body; // uid is not used here

    const history = await prisma.conversationHistory.findMany({
      where: {
        conversationId: id,
      },
      orderBy: { createdAt: "asc" },
    });

    if (!history || history.length === 0) {
      // Return success: false to align with frontend expectations
      return res.json({ success: false, error: "No history found for this conversation" });
    }

    console.log("Fetched conversation history:", history.length, id);

    res.json({ success: true, data: history });
  } catch (error) {
    console.error("Error fetching conversation history:", error);
    res.status(500).json({ error: "Error fetching conversation history" });
  }
};

const createConversation = async (req, res) => {
  try {
    const { id, uid } = req.body;
    
    if (!id || !uid) {
        return res.status(400).json({ success: false, error: "Conversation ID and User ID are required."});
    }

    const newConversation = await prisma.conversation.create({
      data: {
        id: id,
        userId: uid,
        // Prisma's @default(now()) handles createdAt, so no need to pass it
      },
    });

    res.status(201).json({ success: true, data: newConversation });
  } catch (error) {
    console.error("Error creating conversation:", error);
    res.status(500).json({ error: "Error creating conversation" });
  }
};

const fetchStats = async (req, res) => {
  try {
    const docs = await prisma.document.findMany({ select: { id:true, sourceFile:true, stream:true } });
    const bySource = {};
    const byStream = {};
    docs.forEach(d => {
      bySource[d.sourceFile] = (bySource[d.sourceFile]||0)+1;
      byStream[d.stream||'__null__'] = (byStream[d.stream||'__null__']||0)+1;
    });
    res.json({ total: docs.length, sources: bySource, streams: byStream });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

module.exports = { createEmbeddingFromPDF, query, fetchConversationHistory, fetchAllConversationsh, conversationHistory, createConversation, fetchStats };
