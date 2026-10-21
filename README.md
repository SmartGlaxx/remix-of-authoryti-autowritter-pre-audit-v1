# Authoryti AutoWritter

Below are ready-to-paste Lovable flows, written exactly the way Lovable expects them: clear step blocks, explicit inputs/outputs, edge-function aware, state-driven, and non-duplicative.
These flows assume Supabase for persistence, edge functions for AI calls, and frontend orchestration (per Lovable’s architecture).
You can paste these directly into Lovable as flows / tasks documentation or adapt them into edge functions + hooks.
________________________________________
LOVABLE FLOW SET
AUTONOMOUS GENERAL BOOK CREATION ENGINE
________________________________________
FLOW 0 — INITIALIZATION & BOOK STATE CREATION
Trigger
User clicks “Create New Book”
Inputs
•	Book type
•	Theme / subject
•	Optional genre
•	Audience
•	Writing perspective
•	Tone profile
•	Advanced controls (velocity, scope, etc.)
•	Image generation toggle
Steps
1.	Validate inputs
2.	Normalize controls based on book type
3.	Generate Book ID
4.	Create initial Book State Object
5.	Persist to database
Output
•	book_id
•	book_state
{
  "book_id": "uuid",
  "status": "planning",
  "book_type": "",
  "tone_profile": {},
  "pov": "",
  "controls": {},
  "chapter_index": 0,
  "subsection_index": 0,
  "outline": null
}
________________________________________
FLOW 1 — STRUCTURE & OUTLINE PLANNING (NO PROSE)
Trigger
Book created → status = planning
Inputs
•	Book state
•	User constraints
Steps
1.	Call AI (Planner Mode)
2.	Generate:
o	Book goal
o	Chapter list (titles optional)
o	Subsection breakdown
o	Narrative / learning promises
3.	Validate structure
4.	Persist outline
Output
{
  "outline": {
    "chapters": [
      {
        "chapter_id": 1,
        "title": "",
        "subsections": []
      }
    ],
    "open_promises": []
  },
  "status": "ready_to_write"
}
________________________________________
FLOW 2 — SUBSECTION GENERATION LOOP (CORE ENGINE)
Trigger
User clicks “Generate Book” or auto-run enabled
Inputs
•	Current book_state
•	Outline
•	Controls
•	Optional tonal anchors
Steps (LOOP)
1.	Determine next subsection
2.	Assemble AI context:
o	Chapter title
o	Subsection goal
o	Tone profile
o	POV
o	Summary of previous subsection
o	Randomly inject 1–2 verbatim paragraphs (if selected)
3.	Call AI (Writer Mode)
4.	Stream content to UI
5.	Save subsection text
6.	Update indexes
7.	Generate subsection summary (50–100 words)
8.	Persist checkpoint
Output
{
  "chapter_index": 1,
  "subsection_index": 3,
  "last_generated_text": "",
  "subsection_summary": ""
}
________________________________________
FLOW 3 — TONAL ANCHOR SELECTION (RANDOMIZED)
Trigger
Every N subsections (randomized)
Steps
1.	Select last subsection
2.	Randomly extract 1–2 paragraphs
3.	Store as tonal anchors
4.	Flag for future injection
Output
{
  "tonal_anchors": [
    "verbatim paragraph 1",
    "verbatim paragraph 2"
  ]
}
________________________________________
FLOW 4 — CHAPTER COMPLETION & VALIDATION
Trigger
Last subsection of a chapter generated
Steps
1.	Generate chapter summary (300–500 words)
2.	Validate:
o	Entity consistency
o	Promise progression
o	Tone adherence
3.	Update resolved promises
4.	Persist chapter snapshot
Output
{
  "chapter_complete": true,
  "chapter_summary": "",
  "status": "writing"
}
________________________________________
FLOW 5 — IMAGE / VISUAL GENERATION (OPTIONAL)
Trigger
Subsection or chapter completed AND images enabled
Steps
1.	Analyze generated text
2.	Decide image type:
o	Illustration
o	Diagram
o	Chart
o	Step visual
3.	Generate image prompt
4.	Call image model
5.	Store image metadata
Output
{
  "image_type": "",
  "image_prompt": "",
  "image_url": ""
}
________________________________________
FLOW 6 — FAILURE HANDLING & RETRY
Trigger
AI call fails or times out
Steps
1.	Retry up to N times
2.	If still failing:
o	Save failure state
o	Allow manual resume
3.	Never lose progress
________________________________________
FLOW 7 — RESUME AFTER INTERRUPTION
Trigger
User reloads or returns
Steps
1.	Fetch latest book state
2.	Restore indexes
3.	Resume from last checkpoint
________________________________________
FLOW 8 — VERSIONING & SNAPSHOTS
Trigger
•	Chapter completion
•	Manual save
•	Major regeneration
Steps
1.	Clone current state
2.	Save as immutable snapshot
________________________________________
FLOW 9 — FINAL ASSEMBLY & EXPORT
Trigger
All chapters completed
Steps
1.	Validate all promises resolved
2.	Assemble full manuscript
3.	Generate TOC
4.	Export formats:
o	PDF
o	DOCX
o	EPUB
________________________________________
FLOW 10 — OPTIONAL MAGAZINE / SERIAL MODE
Differences
•	Continuous issue generation
•	Period-based grouping
•	Partial exports
________________________________________
UI SUPPORT REQUIREMENT (IMPORTANT)
Each advanced control MUST include:
•	Tooltip
•	Plain-language explanation
•	Example
•	Warning if complexity increases generation time
________________________________________
FINAL NOTE (IMPORTANT)
This system:
•	Does not rely on a single LLM call
•	Is fully resumable
•	Supports novels and non-fiction equally
•	Is production-grade, not demo-grade.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ace4f2f5-9fed-477f-b893-1fc8f40b6f2a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `branch1` on GitLab and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
