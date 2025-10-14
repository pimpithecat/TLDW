# TLDW (Too Long; Didn't Watch)

[](https://www.gnu.org/licenses/agpl-3.0)

TLDW transforms long YouTube videos into topic-driven learning experiences. Using AI, it generates interactive "highlight reels", detailed summaries, and a context-aware chat to help you quickly find and understand the most valuable information.

## Features

  - **🤖 AI-Generated Highlight Reels**: Identifies key themes across the entire video, creating concise, playable segments that capture the most important insights scattered throughout the content.
  - **💬 Interactive AI Chat**: Ask specific questions about the video content and get answers grounded in the transcript, complete with timestamped citations that jump directly to the source.
  - **📝 Detailed Summaries**: Get a comprehensive, structured summary of the video—including key takeaways, smart chapters, and memorable quotes—delivered in clear English.
  - **▶️ Synchronized Transcript & Player**: Read the full transcript with parts highlighted as the video plays. Click any sentence to jump to that moment in the video.
  - **📊 Visual Timeline Navigation**: A dynamic progress bar visualizes where highlight reel segments are located, allowing for quick, non-linear navigation.
  - **❓ Suggested Questions**: Kickstart your exploration with dynamically generated questions based on the video's content.

## How It Works

1.  **Paste a YouTube URL.** The app validates the link and prepares for analysis.
2.  **Analyze Content.** The system fetches the video's transcript and metadata.
3.  **Generate Insights.** In parallel, AI generates:
      - A quick preview for immediate context.
      - Insightful highlight reels based on recurring themes.
      - A detailed, structured summary.
      - A set of suggested questions to guide your inquiry.
4.  **Explore Interactively.** Use the tabbed interface to:
      - **Summary**: Get a quick, structured overview of the entire video.
      - **AI Chat**: Ask specific questions and receive answers with clickable citations.
      - **Transcript**: Read along with highlighting that is synchronized to the video playback.
5.  **Navigate with Precision.** Click on highlight reels, chat citations, or transcript timestamps to instantly play the most relevant parts of the video, saving you time and effort.

## Tech Stack

  - **Framework**: [Next.js](https://nextjs.org/) 15 (with Turbopack)
  - **UI**: [React](https://react.dev/) 19, [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/)
  - **AI**: [Google Gemini API](https://ai.google.dev/) (Gemini 2.5 Flash)
  - **APIs**: [Supadata](https://supadata.ai/) (Transcripts), YouTube oEmbed API
  - **Deployment**: [Vercel](https://vercel.com/)

## Getting Started

### Prerequisites

  - Node.js 18+
  - `npm`, `yarn`, or `pnpm`
  - A Google Gemini API key
  - A Supadata API key

### Installation

1.  Clone the repository:

    ```bash
    git clone https://github.com/yourusername/tldw.git
    cd tldw
    ```

2.  Install dependencies:

    ```bash
    npm install
    ```

3.  Set up environment variables. Create a `.env.local` file in the root directory and add your API keys:

    ```env
    GEMINI_API_KEY="your_gemini_api_key_here"
    SUPADATA_API_KEY="your_supadata_api_key_here"
    ```

4.  Run the development server:

    ```bash
    npm run dev
    ```

5.  Open [http://localhost:3000](https://www.google.com/search?q=http://localhost:3000) in your browser.

## Project Structure

```
.
├── app/
│   ├── api/                  # API routes for backend logic
│   │   ├── chat/             # Handles AI chat Q&A with citations
│   │   ├── generate-summary/ # Generates structured video summaries
│   │   ├── generate-topics/  # Core "Highlight Reel" generation
│   │   ├── quick-preview/    # Creates a fast initial summary
│   │   ├── suggested-questions/ # Generates questions for the chat
│   │   ├── transcript/       # Fetches video transcripts
│   │   └── video-info/       # Fetches video metadata
│   ├── page.tsx              # Main application page component
│   └── layout.tsx            # Root layout
├── components/
│   ├── ai-chat.tsx           # Interactive chat interface
│   ├── summary-viewer.tsx    # Renders the detailed summary
│   ├── right-column-tabs.tsx # Tabbed UI for Summary, Chat, Transcript
│   ├── transcript-viewer.tsx # Displays transcript with highlighting
│   ├── video-progress-bar.tsx# Visual timeline with topic segments
│   └── youtube-player.tsx    # YouTube player wrapper and custom controls
├── lib/
│   ├── quote-matcher.ts      # Algorithms for matching AI quotes to transcript text
│   ├── types.ts              # Core TypeScript type definitions
│   └── utils.ts              # Utility functions
└── ...
```

## Contributing

Contributions are welcome\! Please feel free to open an issue or submit a pull request.

This repository uses the [Anthropic Claude Action](https://github.com/anthropics/claude-code-action) to perform automated code reviews on pull requests. The AI provides feedback on code quality, potential bugs, and adherence to project conventions outlined in `CLAUDE.md`.

## License

This project is licensed under the **GNU Affero General Public License v3.0**. See the [LICENSE](https://www.google.com/search?q=./LICENSE) file for details.
