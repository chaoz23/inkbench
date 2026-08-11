type JsonReviverContext = { source: string } | undefined;
type ContextReviver = (key: string, value: unknown, context?: JsonReviverContext) => unknown;
type ContextJsonParse = (text: string, reviver?: ContextReviver) => unknown;

const parseWithContext = JSON.parse as ContextJsonParse;
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/;
const EXPLICIT_FLOAT = /^-?(?:0|[1-9][0-9]*)\.0$/;

function supportsReviverSource(): boolean {
  return parseWithContext("0", (_key, _value, context) => context?.source === "0") === true;
}

function quoteExplicitFloats(text: string): string {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      output += text.slice(start, index);
      continue;
    }
    if (character === "-" || (character >= "0" && character <= "9")) {
      const number = text.slice(index).match(NUMBER)?.[0];
      if (number) {
        output += EXPLICIT_FLOAT.test(number) ? JSON.stringify(`${number}f`) : number;
        index += number.length;
        continue;
      }
    }
    output += character;
    index += 1;
  }
  return output;
}

/** Parse Ink runtime JSON without inkjs 2.4's Node 20 float-regex corruption. */
export function parseInkJson(text: string, forcePortable = false): Record<string, unknown> {
  if (!forcePortable && supportsReviverSource()) {
    return parseWithContext(text, (_key, value, context) => {
      if (typeof value === "number" && Number.isInteger(value) && context?.source.endsWith(".0")) return `${context.source}f`;
      return value;
    }) as Record<string, unknown>;
  }
  return JSON.parse(quoteExplicitFloats(text)) as Record<string, unknown>;
}
