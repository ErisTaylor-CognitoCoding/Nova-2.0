# Egovex Design Guidelines

## Design Approach
**System-Based with Linear + Notion Inspiration**
This productivity/insight tool requires clarity, information density, and sophisticated data presentation. Drawing from Linear's precise typography and Notion's flexible content layouts while maintaining a professional, trustworthy aesthetic suitable for personal data.

## Typography
- **Primary Font**: Inter (Google Fonts) for clean, readable interface text
- **Display Font**: Inter for consistency
- **Hierarchy**:
  - Hero/Page Headers: font-bold text-3xl to text-5xl
  - Section Headers: font-semibold text-xl to text-2xl
  - Body/Entries: font-normal text-base leading-relaxed
  - Metadata/Citations: font-medium text-sm text-gray-600
  - Timestamps: font-mono text-xs

## Layout System
**Spacing Primitives**: Use Tailwind units of 2, 4, 6, 8, 12, 16, 24
- Component padding: p-4, p-6, p-8
- Section spacing: space-y-8, space-y-12
- Container margins: mx-4, mx-6, mx-8
- Card gaps: gap-4, gap-6

**Grid Structure**:
- Main content: max-w-4xl to max-w-6xl centered
- Sidebar navigation: w-64 fixed (desktop)
- Entry cards: Single column with occasional 2-col grid for metadata
- Mobile: Full-width with px-4 padding

## Core Components

### Navigation
- **Sidebar (Desktop)**: Fixed left navigation with sections for Dashboard, New Entry, Timeline, Patterns, Decisions, Settings
- **Mobile**: Bottom tab bar with primary actions, hamburger menu for secondary
- Icons: Heroicons (outline for inactive, solid for active states)

### Entry Creation Interface
- **Multi-tab selector** for entry types (Voice, Photo, Text, Decision)
- **Voice**: Large circular record button, waveform visualization during recording, elapsed time counter
- **Text**: Distraction-free textarea with word count, auto-save indicator
- **Photo**: Drag-drop zone with grid preview of multiple images, optional caption field
- **Decision**: Structured form with title, description, deadline picker, importance slider

### Timeline View
- **Chronological feed** with date separators (sticky headers)
- **Entry cards** varying by type:
  - Voice: Audio player with transcript preview, duration badge
  - Photo: Image gallery with 2-3 images visible, expand to full view
  - Text: Preview first 3 lines with "Read more" expansion
  - Decision: Status indicator (pending/resolved), deadline countdown
- **Pattern highlights**: Subtle background treatment for connected entries with dotted connector lines

### AI Conversation
- **Chat interface** with clear user/AI distinction
- **User messages**: Right-aligned, minimal background
- **AI responses**: Left-aligned with citation cards below
- **Citation cards**: Compact cards showing entry type icon, date, excerpt with "View full entry" link
- **Pattern callouts**: Highlighted boxes with data visualization (simple bar/line charts using inline SVG)

### Semantic Graph View
- **Node-edge visualization** using D3.js or similar
- **Nodes**: Circles with entry type icons, size indicates importance/frequency
- **Edges**: Lines connecting related entries, thickness shows connection strength
- **Filters**: Toggle buttons for entry types, date range slider
- **Detail panel**: Clicking node reveals entry preview in side panel

### Decision Tracker
- **Kanban-style board** with columns: Pending, In Progress, Resolved
- **Decision cards**: Title, days remaining badge, priority indicator, quick AI insight button
- **Filters**: Sort by deadline, priority, category

### Dashboard
- **Quick stats row**: 4-col grid with total entries, patterns detected, decisions resolved, days active
- **Recent activity feed**: Last 5 entries with type indicators
- **Pattern highlights**: 2-3 featured insights with data viz
- **Quick actions**: Prominent buttons for new entry types

## Visual Patterns
- **Cards**: Rounded corners (rounded-lg), subtle shadow (shadow-sm), hover lift (hover:shadow-md transition)
- **Dividers**: Minimal hairline borders (border-gray-200)
- **Focus states**: Ring outline (ring-2 ring-blue-500) for accessibility
- **Loading states**: Skeleton screens for content areas, spinner for actions
- **Empty states**: Centered illustration placeholder with helpful onboarding text

## Animations
- **Minimal and purposeful only**:
  - Entry card entrance: Fade + slide up (duration-300)
  - Pattern connection reveal: Staggered line drawing
  - NO scroll animations, parallax, or decorative motion

## Images
**No hero image needed** - This is a utility app focused on user-generated content
- **User content images** displayed in entry cards with rounded-lg, object-cover
- **Empty state illustrations**: Simple line art for onboarding (use illustration library like unDraw)

## Responsive Behavior
- **Desktop**: Sidebar + main content area
- **Tablet**: Collapsible sidebar, single-column main
- **Mobile**: Bottom nav, stacked cards, simplified graph view