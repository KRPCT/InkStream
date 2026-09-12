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
    appendCitationCluster(citation: {
      citationID: string;
      citationItems: Array<{ id: string; prefix?: string; suffix?: string; locator?: string; label?: string; 'suppress-author'?: boolean }>;
      properties: { noteIndex: number };
    }): Array<[number, string, string?]>;
  }
  const CSL: { Engine: new (system: {
    retrieveLocale: (language: string) => string | false;
    retrieveItem: (id: string) => Record<string, unknown>;
  }, style: string, language?: string, forceLanguage?: boolean) => Processor };
  export default CSL;
}
