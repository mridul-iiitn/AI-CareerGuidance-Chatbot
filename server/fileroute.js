const express = require("express");
const router = express.Router();
const { createEmbeddingFromPDF, query, fetchConversationHistory,fetchAllConversationsh,conversationHistory,createConversation, fetchStats } = require("./fileController");

//all routes
router.get("/pdf", createEmbeddingFromPDF);
router.get("/stats", fetchStats);
router.post("/query", query);
router.post("/history", fetchConversationHistory);
router.post("/conversationsh", fetchAllConversationsh);
router.post("/conversationHistory", conversationHistory);
router.post("/createConversation", createConversation);

module.exports = router;
