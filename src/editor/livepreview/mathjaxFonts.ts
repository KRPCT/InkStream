/**
 * MathJax newcm SVG 字体 dynamic 子文件全量预载（Phase 5 W2）。
 *
 * 每个子文件 import 副作用调 `MathJaxNewcmFont.dynamicSetup(...)` 把对应字形 path 数据注册进字体类——
 * 全部静态 import 后，SVG 输出对任意字形都同步可取，`convert()` 恒同步、运行时零动态 import（守 CSP
 * script-src 'self'、与 W1 widget 同步时序对齐）。
 *
 * 本文件**只被 mathjaxLoader.buildConverter 动态 import**（`await import('./mathjaxFonts')`），故这 40 个子文件
 * 与之同进 latex 懒加载 chunk、首屏零含。含全字形（拉丁/希腊/西里尔/双线体ℝ/花体/哥特/希伯来ℵ/算符/箭头/
 * 各种 sans-serif 与 monospace 变体等），保任意数学公式字形可渲染。体积权衡（约数 MB 懒 chunk）留 W4 按 bundle 实测裁剪。
 */
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/accents.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/accents-b-i.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/arabic.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/arrows.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/braille.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/braille-d.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/cherokee.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/cyrillic-ss.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/devanagari.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/greek.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/greek-ss.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/hebrew.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-bi.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/marrows.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/math.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-ex.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace-l.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/mshapes.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/phonetics-ss.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/PUA.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-b.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-bi.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-ex.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-i.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif-r.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/shapes.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/symbols-b-i.js';
import '@mathjax/mathjax-newcm-font/js/svg/dynamic/variants.js';
