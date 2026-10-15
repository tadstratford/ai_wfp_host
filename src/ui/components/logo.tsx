/**
 * Brand logo components — single source of truth for the W mark and wordmark.
 *
 *   Mark      — `public/img/logo-mark.svg` (geometric W, 4-color, transparent bg).
 *   Wordmark  — `wordmark-dark.svg` (navy text, transparent bg) ↔
 *               `wordmark-light.svg` (white text, transparent bg), swapped by
 *               Tailwind's `.dark` class.
 *
 * Both wordmarks are transparent — they sit cleanly on any page background.
 * The legacy `newLogo.svg` / `logoLight.svg` / `logoDark.svg` files have an
 * embedded navy rectangle and must not be used in pages.
 *
 * These require the Tailwind CDN `darkMode: "class"` config used by the shells.
 */

export function Mark(props: { size?: number }) {
  const s = props.size || 32;
  return (
    <img
      src="/public/img/logo-mark.svg"
      style={{ height: `${s}px`, width: "auto" }}
      alt="mark"
    />
  );
}

export function Wordmark(props: { size?: number }) {
  const s = props.size || 34;
  return (
    <>
      <img src="/public/img/wordmark-dark.svg" style={{ height: `${s}px`, width: "auto" }} class="dark:hidden" alt="Workflow People" />
      <img src="/public/img/wordmark-light.svg" style={{ height: `${s}px`, width: "auto" }} class="hidden dark:block" alt="Workflow People" />
    </>
  );
}
