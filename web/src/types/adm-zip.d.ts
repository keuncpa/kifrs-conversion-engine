declare module 'adm-zip' {
  interface IZipEntry {
    getData(): Buffer;
    entryName: string;
  }
  class AdmZip {
    constructor(input?: Buffer | string);
    getEntries(): IZipEntry[];
    readAsText(entry: IZipEntry | string, encoding?: string): string;
  }
  export = AdmZip;
}
