/*
 * Websites. A chat can become a project (the agent offers with infra/sandbox/bin/kimono-project, the person
 * agrees), and a Kimono Git repository can be hosted as it is, with no chat behind it: whatever is pushed to its
 * branch is what its link shows (cli/internal/sandbox/deploy.go says how a repository is run).
 */

export const isProjectCommand = (input: string | undefined) => {
  if (!input) return false;
  try { const command = (JSON.parse(input) as { command?: unknown }).command; return typeof command === "string" && /(^|[\s;&|(])kimono-project(\s|$)/.test(command); } catch { return false; }
};

/** What kimono-project prints: the name it offered. */
export const offeredProject = (output: string) => /\(project offer: ([^)\n]{1,60})\)/.exec(output)?.[1].trim() || undefined;

/** Joins an administrator's chat's instructions: how a chat gets to publish. */
export const projectNote = "A chat can't publish, but it can become a project, which can. When the person wants a website or an app that stays up at a link of its own (not something an artifact shows well), build nothing yet: run `kimono-project \"<a short name for it>\"` and end your turn at once. They're asked whether to make a project and move this chat into it; if they agree, your next message says so, everything in /workspace comes along, and kimono-serve works from then on. If they'd rather not, make an artifact instead. Offer once in a chat, and never for something an artifact does as well.";

/** Joins a hosted repository's instructions: its branch is the site. */
export const hostedNote = "This repository is hosted as it is: its site is whatever is on this branch in Kimono Git, and Kimono puts up each new commit pushed there by itself (a kimono.json at the root says how to run it: {\"static\": \"<folder>\"} or {\"command\": [...], \"port\": <n>}; without one, an index.html is served as plain files). So commit your work and `git push origin HEAD` when it's ready, rather than kimono-serve.";
