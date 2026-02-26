---
name: reflect
description: Reflect on identity patterns observed in this session
---

# End-of-Session Reflection

Review what happened in this session and identify identity-relevant patterns.

## Steps

1. Review the conversation for recurring behaviors, values, and tendencies
2. Identify 2-5 identity patterns (not project facts)
3. Write a brief session summary
4. Call `identity:reflect` with the patterns and summary

## Example

```
identity:reflect({
  concepts: [
    { name: "systematic-debugging", context: "traced auth bug to root cause instead of patching symptoms" },
    { name: "test-first", context: "wrote failing tests before fixing login validation" }
  ],
  session_summary: "Fixed authentication bugs using TDD and systematic debugging",
  auto_promote: true
})
```

Focus on **how** you worked, not **what** you built.
