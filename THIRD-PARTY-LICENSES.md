# 第三方许可

## ECDICT 离线词典子集

来源：skywind3000/ECDICT，固定提交 `39cfb9672c0906b63569e0453c2e6abfb9ab182a`。MIT 许可全文保留在 `addon/dictionaries/ECDICT-LICENSE.txt` 并随 XPI 分发。

`python3 scripts/dictionary.py` 校验源 CSV 与 LICENSE 的 SHA-256 后，选择 BNC 或 frq 前 20,000 且中文释义非空的词；8 个必需词也明确列入规则，本次无需额外补入。共 23,081 条，保留 word、phonetic、translation、exchange。未分发 `lemma.en.txt`。复现脚本见 [dictionary.py](scripts/dictionary.py)。

## KaTeX

MIT；构建时将安装版本的完整 LICENSE 合并到 XPI 的 THIRD-PARTY-LICENSES.txt。

## Codex CLI

Codex CLI 单独安装。插件保留其 Apache-2.0 许可文本。[Codex CLI 许可证](addon/codex-LICENSE.txt)
