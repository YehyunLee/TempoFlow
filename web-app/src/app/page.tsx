import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center min-h-screen px-6 py-12">
        <div className="max-w-2xl mx-auto text-center space-y-8">
          {/* Logo */}
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-purple-500 to-pink-500 mb-4">
            <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          {/* Title */}
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-gray-900">
            TempoFlow
          </h1>
          
          {/* Subtitle */}
          <p className="text-xl md:text-2xl text-gray-600 font-light">
            Your AI dance coach that catches what the eye misses
          </p>

          {/* CTA Button */}
          <Link 
            href="/upload"
            className="inline-flex items-center justify-center px-8 py-4 text-lg font-medium text-white bg-gray-900 rounded-full hover:bg-gray-800 transition-all active:scale-95 shadow-lg"
          >
            Start Dancing
          </Link>

          {/* Feature Pills */}
          <div className="flex flex-wrap justify-center gap-3 pt-8">
            <div className="px-4 py-2 bg-gray-100 rounded-full text-sm text-gray-700">
              📹 Video Analysis
            </div>
            <div className="px-4 py-2 bg-gray-100 rounded-full text-sm text-gray-700">
              🎵 Beat Sync
            </div>
            <div className="px-4 py-2 bg-gray-100 rounded-full text-sm text-gray-700">
              ✨ Real-time Feedback
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 p-6 text-center text-sm text-gray-400">
        Made for dancers, by dancers
      </div>
    </div>
  );
}
