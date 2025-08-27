
## **Product proposal: TLDW (too long; didn’t watch)**

## Problem Statement

Knowledge workers spend hours watching long-form YouTube content (interviews, conferences, tutorials) but lack efficient ways to navigate to relevant segments. Users frequently abandon valuable 60+ minute videos due to time constraints and inability to quickly identify content that matches their specific interests.

## Target Audience

**Primary:** Product managers, entrepreneurs, and business professionals (25-45) who:

* Follow industry thought leaders and educational content  
* Have limited time but high learning objectives  
* Prefer targeted consumption over full video watching  
* Share insights with teams and networks

**Secondary:** Developers, marketers, and students consuming technical/educational content

## Key Insights from User Discovery

**Text-first discovery is preferred:** Users consistently convert videos to text because "reading efficiency is higher" and they use AI summaries to decide which parts are worth watching before committing time to video.

**AI summaries lose critical value:** Current AI tools that generate text summaries miss important details, emotional context, specific examples, and "spark moments" that make videos valuable \- users want efficiency without losing the magic.

**Manual workflow indicates demand:** Users are already creating complex multi-step processes (download → transcribe → AI summary → selective watching) showing strong demand for a better solution.

## Current Solutions & Pain Points

**Text Summaries (AI tools like NotebookLM, Gemini, ChatGPT)**

* Lose important details, such as:  
  * Visual demonstrations (whiteboards, coding, presentations)  
  * Emotional moments and anecdotes that create connection  
  * Specific quotes and examples that make concepts memorable  
  * Speaker's tone and delivery that adds meaning  
  * Context clues from body language and environment  
* People increasingly don’t like to read long-form text. Video is much more engaging

**Manual Timestamp Navigation (timestamps provided by YouTube creator/in comments)**

* Brief chapter titles don't capture nuanced discussion themes  
* Time-intensive to find relevant sections  
* Relies on creator-provided chapters (often inadequate)  
* No personalization for individual interests

**AI-Generated Smart Chapters (AI podcast apps like Snipd)**

* Chronological segmentation misses the key insight: users consume videos for specific insights scattered across multiple chapters  
* Brief chapter titles don't capture nuanced discussion themes

**Speed Watching/Skipping**

* Risk missing key insights  
* Cognitive overload from information density  
* Poor retention of scattered viewing

## Key Features

**Cross-Transcript Smart Topics** *(Core Innovation)*

* Generate 4-6 nuanced topics that span the entire video, not just chronological chapters  
* Topics capture complete perspectives scattered across multiple segments  
* AI identifies thematically related discussions regardless of when they occur  
* Quality topic generation is critical to product success  
  Example Output:  
  Original: "44-minute startup advice talk"→ Becomes:   
  \- "Why technical founders struggle with hiring" (6 min)  
  \- "The 3 metrics that actually matter for early-stage startups" (4 min)  
  \- "How to know when you're ready to raise Series A" (8 min)

**Interactive Multi-Segment Highlighting**

* Display entire transcript, satisfying users who want to scan the entire text  
* Highlight all relevant transcript segments when topic is selected (potentially 3-5 scattered sections)  
* Support non-consecutive segment viewing for complete topic coverage  
* Click timestamps to jump directly in video

**Future: Custom Topic Queries**

* Users input specific interests (e.g., "how a PM's job will evolve in the age of AI")  
* AI searches across transcript to find relevant insights matching user query  
* Personalized topic discovery beyond pre-generated themes

**Smart Video Navigation**

* Auto-play feature jumps between highlighted segments  
* Preserve original YouTube player (copyright compliant)  
* Seamless transitions between topic segments

## User Journey

1. **Input:** User pastes YouTube URL into web app  
2. **Processing:** AI analyzes video and generates 4-6 specific topics with durations  
3. **Discovery:** User scans topic list to identify interests (saves 5-10 minutes of evaluation)  
4. **Preview:** User selects topic → sees highlighted transcript segments (text-first validation)  
5. **Consumption:** User clicks "Watch Segments" → auto-plays relevant parts (preserves video experience)  
6. **Navigation:** User easily switches between topics or jumps to specific timestamps  
7. **Sharing:** User shares specific topic insights with team/network

**Value Proposition:** Transform any long YouTube video into a navigable, topic-driven learning experience that captures complete insights scattered throughout the content \- going beyond chronological chapters to deliver thematically coherent perspectives that respect both time constraints and the original video format.

**Key to success:** Quality of AI-generated topics will determine product adoption \- topics must accurately identify and consolidate scattered insights into coherent, valuable themes that users actually want to explore.

