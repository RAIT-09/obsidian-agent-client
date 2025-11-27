# UX/UI Enhancement Plan

This document outlines the plan for a comprehensive user experience and interface enhancement for the Agent Client Plugin.

## Phase 1: Design System & Style Consolidation (Completed)

- [x] Define a consistent design system with CSS variables for colors, typography, spacing, etc.
- [x] Consolidate all scattered CSS files (`styles.css`, `terminal.css`, etc.) into a single, unified `main.css` file.
- [x] Remove all old, now-redundant CSS files from the project.
- [x] Update component classNames to work with the new unified stylesheet.

## Phase 2: Redesign Core Chat Components (Completed)

- [x] **Message Bubbles:** Redesigned user and assistant message bubbles with distinct visual treatments. User messages have gradient backgrounds with subtle shadows and rounded corners. Assistant messages are clean and content-focused.
- [x] **Avatars:** Added rounded avatars with role-specific styling. User avatars use accent gradient with glow effect. Assistant avatars have subtle accent-colored icons.
- [x] **Message Content:** Improved layout with proper spacing, visual hierarchy, and consistent typography using the design system variables.
- [x] **Loading Indicator:** Redesigned with bouncing dots animation, optional label, and subtle container styling with border and background.

## Phase 3: Improve Agent Interaction Components (Completed)

- [x] **Collapsible Thoughts:** Redesigned with CSS Grid-based smooth height animation (no JavaScript height calculation). Added `variant="subtle"` option with preview text in meta field. Uses `collapsible-block-content-wrapper` pattern for smooth expand/collapse.
- [x] **Tool Calls:** Redesigned `ToolCallRenderer` with compact header showing icon, title, and status badge. Status badges have semantic colors (running=blue with pulse animation, completed=green, error=red). Clean layout with proper overflow handling.
- [x] **Permission Requests:** Improved layout with gradient warning background, slide-in animation, and color-coded action buttons (allow=green border, deny=red border). Results show inline with fade-in animation.

## Phase 4: Refine Input & Suggestions UI (Completed)

- [x] **Input Area:** Modernized with rounded corners, gradient container background, hover/focus states with glow effect. Send button transforms to accent color on hover with scale animations. Auto-mention badge and pasted images preview integrated seamlessly.
- [x] **Suggestion Dropdown:** Redesigned with backdrop blur, rounded items with accent border on selection, custom scrollbar styling, icon backgrounds, and improved keyboard hint footer. Category headers are more compact with proper spacing.

## Phase 5: Add Subtle Feedback and Animations (Completed)

- [x] **Transitions:** Added global smooth transitions for all interactive elements using `cubic-bezier(0.4, 0, 0.2, 1)` easing. Header buttons, cards, and form elements have consistent hover/active states.
- [x] **Animations:** Added message fade-in (`message-fade-in`), permission slide-in (`permission-slide-in`), dropdown appear (`dropdown-appear`), collapsible expand with opacity+transform, status pulse for running state, and result fade-in animations.

---

## Implementation Summary

### Key CSS Patterns Used

1. **CSS Grid Animation**: Used `grid-template-rows: 0fr` → `1fr` for smooth collapsible height animation without JavaScript
2. **Gradient Backgrounds**: Subtle gradients for depth (user messages, input container, permission requests)
3. **Shadow Hierarchy**: `--ai-shadow-s` for subtle elevation, custom shadows for prominent elements
4. **Semantic Color System**: Status colors (success/warning/danger/info) with consistent alpha variations

### Components Modified

| Component | File | Changes |
|-----------|------|---------|
| MessageRenderer | `MessageRenderer.tsx` | Uses existing avatar with improved CSS |
| LoadingIndicator | `LoadingIndicator.tsx` | Added `showLabel` prop and wrapper structure |
| CollapsibleBlock | `CollapsibleBlock.tsx` | Added `variant` prop, content wrapper for animation, ARIA controls |
| CollapsibleThought | `CollapsibleThought.tsx` | Uses subtle variant, adds preview in meta |
| ToolCallRenderer | `ToolCallRenderer.tsx` | Added status class helpers and semantic display text |

### Design System Variables

All styling uses the CSS custom properties defined in `main.css` root:
- Colors: `--ai-accent`, `--ai-success`, `--ai-warning`, `--ai-danger`, etc.
- Spacing: `--ai-spacing-xs` through `--ai-spacing-xl`
- Typography: `--ai-font-size-s/m/l`, `--ai-font-family-body/mono`
- Borders: `--ai-radius-s/m/l`, `--ai-border-color` variants
- Transitions: `--ai-transition` (0.2s cubic-bezier)
