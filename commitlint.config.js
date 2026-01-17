export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', [
      'feat',     // New feature
      'fix',      // Bug fix
      'docs',     // Documentation
      'refactor', // Code refactoring
      'test',     // Adding tests
      'chore',    // Maintenance
      'style',    // Formatting
      'perf',     // Performance
      'ci',       // CI/CD
      'build',    // Build system
      'revert'    // Revert commit
    ]],
    'subject-case': [0], // Disable case checking
    'body-max-line-length': [0] // Allow long bodies for co-author
  }
};
