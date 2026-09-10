# Typst preview fonts

These unmodified font files are shipped with InkStream for offline Typst block previews. They are loaded from the application's own origin; the preview compiler does not request CDN fonts or inspect installed system fonts.

`manifest.json` records each exact download URL, byte size, SHA-256, and the copyright/family/version records read from the font's OpenType name table. Font metadata is retained in every binary.

| Font files | Version in the font | Copyright | License |
| --- | --- | --- | --- |
| `LibertinusSerif-{Regular,Bold,Italic,BoldItalic}.otf` | 7.051 | 2012–2024 The Libertinus Project Authors | `LICENSE-Libertinus.txt` — SIL Open Font License 1.1 |
| `NewCMMath-Regular.otf` | 4.0 | 2019–2021 Antonis Tsolomitis | `LICENSE-GUST.txt`, with `LICENSE-LPPL-1.3c.txt` |
| `NewCMMath-Bold.otf` | 5.3.0 | 2019–2021 Antonis Tsolomitis | `LICENSE-GUST.txt`, with `LICENSE-LPPL-1.3c.txt` |
| `NotoSerifCJKsc-Regular.otf` | 2.003 | 2017–2024 Adobe | `LICENSE-Noto-CJK.txt` — SIL Open Font License 1.1 |

The two New Computer Modern math faces have different upstream version records; this package retains exactly the pair distributed by the pinned Typst asset release.

Font binaries come from the official [Typst assets v0.13.1 snapshot](https://github.com/typst/typst-assets/tree/ad8080d46d42fca909562572cfa14a86f00eb945/files/fonts) and the [Noto CJK Serif full Simplified Chinese snapshot](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/OTF/SimplifiedChinese). The bundled copies have not been renamed or modified by InkStream. The asset repositories' source-code license does not replace each font's own license above.

The Noto file is the complete upstream SC OTF (24,543,080 bytes), not the 1.35 MB subset in Typst's development assets. Its Unicode cmap maps all 20,992 codepoints in U+4E00–U+9FFF. This is a cmap coverage statement, not a claim that all Unicode ideograph extensions or every academic symbol are covered.

The preview defaults to Libertinus Serif with Noto Serif CJK SC fallback and New Computer Modern mathematics. Arbitrary font names and external Typst package/file imports are outside this standalone block preview's bundled assets.
