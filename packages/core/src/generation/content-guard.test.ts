import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionsPostingFraming, isPostingFramed } from "./content-guard.js";

test("flags cards that quiz the posting instead of the skill", () => {
  const bad = [
    "What educational background is required for this role?",
    "What academic disciplines are considered qualifying quantitative fields for this Data Scientist role?",
    "What are the core technical experience requirements for applicants with a Bachelor's degree?",
    "How does having a Master's degree alter the required years of experience for this role?",
    "What level of advanced education is listed as a preferred nice-to-have qualification?",
    "How does holding a preferred Master's degree benefit a candidate during the evaluation process?",
  ];
  for (const text of bad) assert.equal(mentionsPostingFraming(text), true, text);
});

test("passes genuine domain-knowledge content", () => {
  const good = [
    "What is the difference between a Type I and Type II error in hypothesis testing?",
    "Explain the curse of dimensionality and how it impacts machine learning models.",
    "How do you handle missing data in a large dataset using Python or R?",
    "What is the difference between a SQL JOIN and a SQL UNION?",
    "Walk me through how you would design a rate limiter for a public API.",
  ];
  for (const text of good) assert.equal(mentionsPostingFraming(text), false, text);
});

test("isPostingFramed checks every part of a card/question", () => {
  assert.equal(isPostingFramed(["What is a hash map?", "A key-value structure."]), false);
  assert.equal(
    isPostingFramed(["What is a hash map?", "It's required for this role because..."]),
    true,
  );
});
