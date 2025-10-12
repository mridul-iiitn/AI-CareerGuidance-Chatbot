"use client"
import { motion } from "framer-motion"
import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Code, Briefcase, Lightbulb} from "lucide-react"
import { LogIn } from "lucide-react"
import Image from "next/image"

export function HeroSectionOne() {
  const router = useRouter()
  const [activeFeature, setActiveFeature] = useState(0)

  const features = [
    { icon: <Code className="h-5 w-5" />, text: "Trending Technologies" },
    { icon: <Briefcase className="h-5 w-5" />, text: "Industry Insights" },
    { icon: <Lightbulb className="h-5 w-5" />, text: "AI-powered Guidance" },
  ]

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [features.length])

  const handleExploreClick = () => {
    router.push("/sign-up")
  }

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center justify-center px-4 bg-gradient-to-br from-gray-50 via-white to-purple-50 dark:from-gray-950 dark:via-black dark:to-purple-950">
      {/* ✅ Fixed: Add pointer-events-none */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -left-20 top-20 h-[400px] w-[400px] rounded-full bg-purple-500/20 blur-3xl" />
        <div className="absolute right-20 top-60 h-[300px] w-[300px] rounded-full bg-pink-500/15 blur-3xl" />
        <div className="absolute bottom-20 left-40 h-[250px] w-[350px] rounded-full bg-purple-600/10 blur-3xl" />
      </div>

      <Navbar />

      {/* Border decorations */}
      <div className="absolute inset-y-0 left-0 h-full w-px bg-neutral-200/80 dark:bg-neutral-800/80">
        <div className="absolute top-0 h-40 w-px bg-gradient-to-b from-transparent via-blue-500 to-transparent" />
      </div>
      <div className="absolute inset-y-0 right-0 h-full w-px bg-neutral-200/80 dark:bg-neutral-800/80">
        <div className="absolute h-40 w-px bg-gradient-to-b from-transparent via-blue-500 to-transparent" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-px w-full bg-neutral-200/80 dark:bg-neutral-800/80">
        <div className="absolute mx-auto h-px w-40 bg-gradient-to-r from-transparent via-blue-500 to-transparent" />
      </div>

      <div className="px-4 py-10 md:py-20 w-full">
        {/* ✅ Fixed: Updated main content to match careers platform layout */}
        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
          {/* Left Content */}
          <div className="space-y-8">
            <div className="inline-block px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-medium dark:bg-purple-900/30 dark:text-purple-300">
              Step 1
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 dark:text-white leading-tight">
              Use comparative judgement to discover {""}
              <span className="text-purple-600 dark:text-purple-400">what&apos;s most important to you</span> in a career 🤔
            </h1>

            <p className="text-lg text-gray-600 dark:text-gray-300 leading-relaxed">
              Far more than a career quiz, our AI-powered platform identifies your top career qualities and empowers you
              to choose careers that align with them. Or if you already know what career you want to pursue, you can
              skip the quiz and jump straight to step 2...
            </p>

            {/* Rotating features indicator */}
            <div className="flex gap-4 items-center" aria-label="Key platform features">
              {features.map((f, idx) => (
                <div
                  key={f.text}
                  className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors border ${
                    idx === activeFeature
                      ? "bg-purple-600 text-white border-purple-600"
                      : "bg-white/40 dark:bg-white/10 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600"
                  }`}
                >
                  {f.icon}
                  {f.text}
                </div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.5 }}
              className="flex flex-wrap gap-4"
            >
              <button
                onClick={handleExploreClick}
                className="px-8 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors"
              >
                Get Started
              </button>
              <button className="px-8 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800">
                Learn More
              </button>
            </motion.div>
          </div>

          {/* Right Content - Career Comparison */}
          <div className="relative">
            <div className="text-right mb-4">
              <span className="text-gray-600 dark:text-gray-400 font-medium">Choose Between...</span>
            </div>

            <div className="space-y-4">
              {/* Financial Risk Analyst Card */}
              <div className="relative bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                <div className="absolute -top-2 -right-2 w-16 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"></div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-2">Financial Risk Analyst</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Financial risk analysts identify and analyse the areas of potential risk threatening the assets,
                  earning capacity or success of organisations.
                </p>
              </div>

              {/* OR Divider */}
              <div className="flex items-center justify-center">
                <div className="bg-purple-600 text-white px-6 py-2 rounded-full font-medium text-sm">OR</div>
              </div>

              {/* Painter & Decorator Card */}
              <div className="relative bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-gray-700">
                <div className="absolute -bottom-2 -left-2 w-16 h-8 bg-gradient-to-r from-pink-500 to-purple-500 rounded-full"></div>
                <h3 className="font-bold text-lg text-gray-900 dark:text-white mb-2">Painter & Decorator</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Painters and decorators prepare and apply paint, wallpaper and finishes to different surfaces.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-32 max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Your Journey to the Perfect Career
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Follow our proven 3-step process to discover and pursue your ideal career path
            </p>
          </div>

          <div className="space-y-20">
            {/* Step 1 - Left aligned */}
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <div className="inline-block px-4 py-2 bg-purple-100 text-purple-700 rounded-full text-sm font-medium dark:bg-purple-900/30 dark:text-purple-300">
                  Step 1
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
                  Discover Your Career Priorities
                </h3>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-lg">
                  Use comparative judgement to identify {""}
                  <span className="font-semibold text-purple-600 dark:text-purple-400">what&apos;s most important</span> for
                  you — salary, growth, creativity, stability, or impact. This sets the foundation for choosing the
                  right path.
                </p>
              </div>
              <div className="relative">
                <div className="w-full h-64 bg-gradient-to-br from-purple-100 to-pink-100 dark:from-purple-900/30 dark:to-pink-900/30 rounded-2xl flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-white font-bold text-xl">1</span>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 font-medium">Priority Discovery</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 2 - Right aligned */}
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="lg:order-2 space-y-6">
                <div className="inline-block px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-medium dark:bg-blue-900/30 dark:text-blue-300">
                  Step 2
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
                  Chat with our AI Career Assistant
                </h3>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-lg">
                  Confused about{" "}
                  <span className="font-semibold text-blue-600 dark:text-blue-400">engineering vs. medicine</span>?
                  Curious about{" "}
                  <span className="font-semibold text-blue-600 dark:text-blue-400">law, design, or UPSC</span>? Ask our{" "}
                  <span className="text-purple-600 dark:text-purple-400 font-semibold">AI-powered chatbot</span>{" "}
                  anything: scope of fields, required entrance exams, top universities, or future career opportunities.
                </p>
              </div>
              <div className="lg:order-1 relative">
                <div className="w-full h-64 bg-gradient-to-br from-blue-100 to-cyan-100 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-2xl flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-white font-bold text-xl">2</span>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 font-medium">AI Career Chat</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3 - Left aligned */}
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <div className="inline-block px-4 py-2 bg-green-100 text-green-700 rounded-full text-sm font-medium dark:bg-green-900/30 dark:text-green-300">
                  Step 3
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">
                  Get Your Personalized Career Roadmap
                </h3>
                <p className="text-gray-600 dark:text-gray-300 leading-relaxed text-lg">
                  Based on your interests and priorities, we generate a tailored roadmap with
                  <span className="font-semibold text-green-600 dark:text-green-400"> recommended career fields</span>,
                  <span className="font-semibold text-green-600 dark:text-green-400"> entrance exams</span>, and
                  <span className="font-semibold text-green-600 dark:text-green-400"> universities</span> — so you know
                  exactly what steps to take after 12th.
                </p>
              </div>
              <div className="relative">
                <div className="w-full h-64 bg-gradient-to-br from-green-100 to-emerald-100 dark:from-green-900/30 dark:to-emerald-900/30 rounded-2xl flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                      <span className="text-white font-bold text-xl">3</span>
                    </div>
                    <p className="text-gray-700 dark:text-gray-300 font-medium">Personalized Roadmap</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

       
        

        {/* Preview Image */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 1.2 }}
          className="relative z-10 mt-20 rounded-3xl border border-neutral-200 bg-neutral-100 p-4 shadow-md dark:border-neutral-800 dark:bg-neutral-900 max-w-4xl mx-auto"
        >
          <div className="w-full overflow-hidden rounded-xl border border-gray-300 dark:border-gray-700">
            <Image
              src="/home.png"
              alt="Landing page preview"
              className="h-auto w-full object-contain"
              height={1000}
              width={1000}
              priority
            />
          </div>
        </motion.div>
      </div>

      {/* ✅ Fixed: Added copyright footer */}
      <footer className="w-full border-t border-gray-200 dark:border-gray-800 py-6 mt-20">
        <div className="max-w-6xl mx-auto px-4 text-center text-sm text-gray-600 dark:text-gray-400">
          <p>&copy; 2025 CareerPath AI. All rights reserved.</p>
          <p className="mt-2">Empowering people to find their dream careers through AI-powered guidance.</p>
        </div>
      </footer>
    </div>
  )
}

// Navbar component
const Navbar = () => {
  const router = useRouter()

  const handleExploreClick = () => {
    console.log("SignIn button clicked")
    router.push("/sign-in")
  }

  return (
    <nav className="flex w-full items-center justify-between border-t border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
      <div className="flex items-center gap-2">
        <motion.div
          whileHover={{ rotate: 10 }}
          className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600"
        >
          <span className="text-sm font-bold text-white">C</span>
        </motion.div>
        <h1 className="text-base font-bold md:text-2xl">CareerPath AI</h1>
      </div>
      <button
        style={{ position: "relative", zIndex: 9999 }}
        className="pointer-events-auto"
        onClick={handleExploreClick}
      >
        <div className="flex items-center gap-2">
          <LogIn />
          SignIn
        </div>
      </button>
    </nav>
  )
}