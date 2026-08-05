const BAD_WORDS = [
  "admin", "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick", "pussy", "nigger", "faggot"
];

export function isCleanName(name: string): boolean {
  const lower = name.toLowerCase().trim();
  return !BAD_WORDS.some((word) => lower.includes(word));
}
