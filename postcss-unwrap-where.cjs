// `:where(x)` is only there to zero specificity; older TV browsers drop any
// rule containing it. Unwrapping keeps the rule alive at slightly higher
// specificity, which Tailwind's utility ordering tolerates.
const unwrapWhere = () => ({
  postcssPlugin: "unwrap-where",
  Rule(rule) {
    if (!rule.selector.includes(":where(")) return;
    let s = rule.selector;
    let i;
    while ((i = s.indexOf(":where(")) !== -1) {
      let depth = 1;
      let j = i + 7;
      for (; j < s.length && depth; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") depth--;
      }
      const inner = s.slice(i + 7, j - 1);
      // A list inside :where can't be inlined; leave that rule as is.
      if (inner.includes(",")) return;
      s = s.slice(0, i) + inner + s.slice(j);
    }
    rule.selector = s;
  },
});
unwrapWhere.postcss = true;
module.exports = unwrapWhere;
