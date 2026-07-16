module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-leading-blank": [2, "always"],
    "footer-leading-blank": [2, "always"],
  },
  helpUrl: "https://github.com/conventional-changelog/commitlint/#what-is-commitlint",
};
