declare module 'citeproc' {
  interface BibliographyParameters {
    entry_ids: string[][];
    bibliography_errors: unknown[];
    hangingindent?: boolean;
  }
  interface Processor {
    setOutputFormat(format: 'html' | 'text'): void;
    updateItems(ids: string[]): void;
    makeBibliography(): [BibliographyParameters, string[]] | false;
  }
  const CSL: { Engine: new (system: {
    retrieveLocale: (language: string) => string | false;
    retrieveItem: (id: string) => Record<string, unknown>;
  }, style: string, language?: string, forceLanguage?: boolean) => Processor };
  export default CSL;
}
