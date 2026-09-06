/**
 * The container URL is not a hop: it renders the first sub-tab in place, so
 * `/teams` and `/teams/roster` are the same screen and no link needs to know
 * which one it wrote. The tab bar in `layout.tsx` already treats a bare
 * container path as the default sub-tab.
 */
export { default } from "./roster/page";
