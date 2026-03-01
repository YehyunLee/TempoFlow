"use client";

import Link from 'next/link';

export default function DashboardPage() {
  // Sample data - in real app this would come from API
  const sessions = [
    {
      id: 1,
      videoName: "BTS - Butter Practice",
      uploadDate: "2 hours ago",
      score: 85,
      status: "analyzed"
    },
    {
      id: 2,
      videoName: "BLACKPINK - How You Like That",
      uploadDate: "1 day ago",
      score: 92,
      status: "analyzing"
    },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b border-gray-100 z-10">
        <div className="flex items-center justify-between px-6 py-4">
          <Link href="/" className="text-2xl font-bold text-gray-900">
            TempoFlow
          </Link>
          <Link 
            href="/upload"
            className="px-4 py-2 bg-gray-900 text-white rounded-full text-sm font-medium hover:bg-gray-800 transition-all active:scale-95"
          >
            Upload
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-6 py-24 max-w-4xl mx-auto">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Your Dances</h1>
          <p className="text-gray-600">Track your progress and improve</p>
        </div>

        {/* Sessions List */}
        <div className="space-y-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="bg-gray-50 rounded-3xl p-6 hover:bg-gray-100 transition-all cursor-pointer active:scale-[0.98]"
            >
              <div className="flex items-center justify-between gap-4">
                {/* Video Icon & Info */}
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{session.videoName}</h3>
                    <p className="text-sm text-gray-500">{session.uploadDate}</p>
                  </div>
                </div>

                {/* Score/Status */}
                <div className="flex items-center gap-3">
                  {session.status === "analyzed" ? (
                    <div className="text-right">
                      <div className="text-2xl font-bold text-gray-900">{session.score}</div>
                      <div className="text-xs text-gray-500">Score</div>
                    </div>
                  ) : (
                    <div className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium">
                      Analyzing...
                    </div>
                  )}
                  
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {sessions.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 mx-auto bg-gray-100 rounded-3xl flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No dances yet</h3>
            <p className="text-gray-600 mb-6">Upload your first video to get started</p>
            <Link
              href="/upload"
              className="inline-flex items-center justify-center px-6 py-3 text-base font-medium text-white bg-gray-900 rounded-full hover:bg-gray-800 transition-all active:scale-95"
            >
              Upload Video
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
