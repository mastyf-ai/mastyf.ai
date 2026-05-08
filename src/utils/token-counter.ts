import { get_encoding, TiktokenEncoding } from 'tiktoken';

export class TokenCounter {
  private encoding: ReturnType<typeof get_encoding>;

  constructor(model: string = 'gpt-4o') {
    // o200k_base is the encoding used by gpt-4o and gpt-4o-mini
    const encodingName: TiktokenEncoding = 'o200k_base';
    this.encoding = get_encoding(encodingName);
  }

  count(text: string): number {
    return this.encoding.encode(text).length;
  }

  free(): void {
    this.encoding.free();
  }
}