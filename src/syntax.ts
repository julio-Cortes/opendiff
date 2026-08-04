import { addDefaultParsers, SyntaxStyle } from "@opentui/core"
import { fileURLToPath } from "node:url"
import { COLORS } from "./config"

addDefaultParsers([{
  filetype: "python",
  queries: { highlights: [fileURLToPath(import.meta.resolve("tree-sitter-python/queries/highlights.scm"))] },
  wasm: fileURLToPath(import.meta.resolve("tree-sitter-python/tree-sitter-python.wasm")),
}])

export function createSyntaxStyle() {
  return SyntaxStyle.fromStyles({
    default: { fg: COLORS.text },
    keyword: { fg: COLORS.syntaxKeyword, bold: true },
    "keyword.import": { fg: COLORS.syntaxKeyword, bold: true },
    "keyword.operator": { fg: COLORS.syntaxKeyword },
    string: { fg: COLORS.syntaxString },
    comment: { fg: COLORS.syntaxComment, italic: true },
    number: { fg: COLORS.syntaxNumber },
    boolean: { fg: COLORS.syntaxNumber },
    constant: { fg: COLORS.syntaxNumber },
    function: { fg: COLORS.syntaxFunction },
    "function.call": { fg: COLORS.syntaxFunction },
    constructor: { fg: COLORS.syntaxType },
    type: { fg: COLORS.syntaxType },
    operator: { fg: COLORS.syntaxKeyword },
    variable: { fg: COLORS.text },
    "variable.member": { fg: COLORS.syntaxProperty },
    property: { fg: COLORS.syntaxProperty },
    bracket: { fg: COLORS.text },
    "punctuation.bracket": { fg: COLORS.text },
    "punctuation.delimiter": { fg: COLORS.text },
    punctuation: { fg: COLORS.text },
  })
}
