# TLDW (Too Long; Didn't Watch)

Smart video navigation that transforms long YouTube videos into topic-driven learning experiences.

## Features

- **Cross-Transcript Smart Topics**: AI generates 4-6 nuanced topics that span the entire video, capturing complete perspectives scattered across multiple segments
- **Interactive Multi-Segment Highlighting**: View entire transcript with highlighted relevant segments when topics are selected
- **Smart Video Navigation**: Auto-play feature jumps between highlighted segments seamlessly
- **Text-First Discovery**: Scan topics and preview transcript segments before committing time to video

## Getting Started

### Prerequisites

- Node.js 18+ installed
- OpenAI API key for topic generation

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/tldw.git
cd tldw
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env.local` file in the root directory and add your OpenAI API key:
```
OPENAI_API_KEY=your_openai_api_key_here
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Usage

1. **Input**: Paste a YouTube URL into the input field
2. **Processing**: The app fetches the transcript and generates smart topics using AI
3. **Discovery**: Browse the generated topics to identify your interests
4. **Preview**: Select a topic to see highlighted transcript segments
5. **Consumption**: Click timestamps or use "Play Topic Segments" to watch relevant parts
6. **Navigation**: Switch between topics or jump to specific timestamps easily

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes
- **AI**: OpenAI GPT-4 for topic generation
- **Video**: YouTube IFrame API for player integration
- **Transcript**: youtube-transcript library for fetching video transcripts

## Project Structure

```
tldw/
├── app/
│   ├── api/
│   │   ├── transcript/        # Fetches YouTube transcripts
│   │   └── generate-topics/   # AI topic generation
│   ├── page.tsx               # Main application page
│   └── layout.tsx             # App layout and metadata
├── components/
│   ├── url-input.tsx          # YouTube URL input component
│   ├── topic-card.tsx         # Topic discovery cards
│   ├── transcript-viewer.tsx  # Transcript with highlighting
│   └── youtube-player.tsx     # Custom YouTube player controls
├── lib/
│   ├── types.ts               # TypeScript type definitions
│   └── utils.ts               # Utility functions
└── prd.md                     # Product requirements document
```

## Building for Production

```bash
npm run build
npm start
```

## Deployment

The app is ready to deploy on Vercel:

1. Push your code to GitHub
2. Import the project in Vercel
3. Add your `OPENAI_API_KEY` in Vercel environment variables
4. Deploy!

## License

MIT