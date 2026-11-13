const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const html = readFileSync(join(__dirname, "..", "Space-Explorer-Quiz.html"), "utf8");
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inlineScript, "quiz inline script should exist");

class FakeClassList {
  constructor(value = "") {
    this.values = new Set(value.split(/\s+/).filter(Boolean));
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = { setProperty() {} };
    this.classList = new FakeClassList();
  }

  set className(value) {
    this.classList = new FakeClassList(value);
  }

  addEventListener(type, callback) {
    this.listeners[type] = callback;
  }

  click() {
    this.listeners.click?.();
  }

  focus() {}

  append(...elements) {
    this.children.push(...elements);
  }

  replaceChildren(...elements) {
    this.children = [...elements];
  }

  querySelector(selector) {
    if (selector !== ".answer-text") return null;
    this.answerText ??= new FakeElement();
    return this.answerText;
  }

  querySelectorAll(selector) {
    return selector === ".answer" ? this.children : [];
  }

  insertAdjacentHTML() {}

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

function createQuiz(storage = new Map(), { storageUnavailable = false, writesUnavailable = false } = {}) {
  const elements = new Map();
  const document = {
    body: new FakeElement(),
    documentElement: { dataset: {} },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement());
      return elements.get(id);
    },
    createElement() {
      return new FakeElement();
    }
  };
  const localStorage = {
    getItem(key) {
      return storage.get(key) ?? null;
    },
    setItem(key, value) {
      if (writesUnavailable) throw new Error("local storage is unavailable");
      storage.set(key, value);
    }
  };
  const window = {
    matchMedia: () => ({ matches: false })
  };

  if (storageUnavailable) {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("local storage is unavailable");
      }
    });
  } else {
    window.localStorage = localStorage;
  }

  const context = vm.createContext({ document, window });
  vm.runInContext(`${inlineScript}\nglobalThis.__testQuestions = questions;`, context);
  return { context, elements, storage };
}

function finishQuiz(quiz, targetScore) {
  const { context, elements } = quiz;
  for (const [index, question] of context.__testQuestions.entries()) {
    const correctIndex = question.correct;
    const selectedIndex = index < targetScore ? correctIndex : (correctIndex + 1) % question.answers.length;
    elements.get("answers").children[selectedIndex].click();
    elements.get("nextButton").click();
  }
}

test("records and displays a new personal best", () => {
  const quiz = createQuiz();
  finishQuiz(quiz, 8);

  assert.equal(quiz.storage.get("orbitAcademyPersonalBest"), "8");
  assert.equal(quiz.elements.get("finalScore").textContent, "8/10");
  assert.equal(quiz.elements.get("personalBest").textContent, "Personal best: 8/10");
});

test("keeps a higher score after a lower run and page reload", () => {
  const storage = new Map();
  finishQuiz(createQuiz(storage), 9);
  const secondRun = createQuiz(storage);
  finishQuiz(secondRun, 4);

  assert.equal(storage.get("orbitAcademyPersonalBest"), "9");
  assert.equal(secondRun.elements.get("personalBest").textContent, "Personal best: 9/10");
});

test("records zero as the first completed score", () => {
  const quiz = createQuiz();
  finishQuiz(quiz, 0);

  assert.equal(quiz.storage.get("orbitAcademyPersonalBest"), "0");
  assert.equal(quiz.elements.get("personalBest").textContent, "Personal best: 0/10");
});

test("replaces malformed saved data without blocking the quiz", () => {
  const storage = new Map([["orbitAcademyPersonalBest", "not-a-score"]]);
  const quiz = createQuiz(storage);
  finishQuiz(quiz, 5);

  assert.equal(storage.get("orbitAcademyPersonalBest"), "5");
  assert.equal(quiz.elements.get("personalBest").textContent, "Personal best: 5/10");
});

test("keeps the quiz playable and shows the empty state when storage is denied", () => {
  const quiz = createQuiz(new Map(), { storageUnavailable: true });
  finishQuiz(quiz, 5);

  assert.equal(quiz.elements.get("quizScreen").hidden, true);
  assert.equal(quiz.elements.get("resultScreen").classList.contains("visible"), true);
  assert.equal(quiz.elements.get("finalScore").textContent, "5/10");
  assert.equal(quiz.elements.get("personalBest").textContent, "Personal best: No personal best yet");
});

test("keeps the quiz playable when saving to storage fails", () => {
  const quiz = createQuiz(new Map(), { writesUnavailable: true });
  finishQuiz(quiz, 5);

  assert.equal(quiz.elements.get("finalScore").textContent, "5/10");
  assert.equal(quiz.elements.get("personalBest").textContent, "Personal best: No personal best yet");
});
