import { cyan } from "ansis";
import { red } from "ansis";
import { yellow } from "ansis";

export function colorNumber(num: any) {
  return red.bold(`#${num}`);
}

export function colorHex(hex: any) {
  return yellow.bold(`${hex}`);
}

export function colorWord(word: any) {
  return cyan.bold(word);
}
