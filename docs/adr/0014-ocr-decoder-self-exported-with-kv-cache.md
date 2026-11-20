---
status: accepted
---

# OCR decoder 用自己匯出、自己托管的 KV cache 版本

manga-ocr 的 greedy decode 每一步都把整段序列重算，連 cross-attention 對 encoder 197 個 token 的 K/V 也每步重算，翻頁時 decoder 占整頁 OCR 的 70–90%。改用帶 past key/value 的 decoder 可以解決，但 onnx-community 的 `manga-ocr-base-ONNX` 只有不帶 past 的 `decoder_model.onnx`，Optimum 也拒絕替 BERT decoder 匯出帶 past 的版本（`image-to-text-with-past`）。我們決定用 `kha-white/manga-ocr-base` 的權重自己寫帶 past 的 decoder，用 `torch.onnx.export` 匯出 `cross_kv` 和 `decoder_with_past`（fp32 給 WebGPU、q8 給 wasm），托管在自己的 Hugging Face repo（`yurenju/manga-ocr-base-kv-onnx`），跟其他模型一樣固定 revision、驗 SHA-256。encoder 仍用 onnx-community 的發布版。實驗和數字見 [#317](https://github.com/yurenju/naruhodo-manga-translator/issues/317)。

## 後果

- **之後要換 OCR 模型或升級權重，都得自己重新匯出。** 匯出腳本和環境版本放在 repo 的 `scripts/models/`，模型才能重現。
- **WebGPU 上 past 和 cross K/V 一定要留在 GPU**（`preferredOutputLocation: 'gpu-buffer'`），只讀回 logits。每步讀回 CPU 只快約 1.5 倍，留在 GPU 才有約 5 倍；之後有人想「簡化」成 CPU tensor，會吃掉大部分收益。
- **wasm 路徑也用 KV cache**，`ort-engine.ts` 只有一套 decode 迴圈。
- **已下載模型的使用者要補下載新 decoder**（WebGPU 約 117 MB、wasm 約 30 MB）。外掛更新時，舊那組已經完整下載的使用者會在背景補下載缺的檔案；快取裡不屬於任何一組 `MODEL_SETS` 的檔案，在一組模型下載完之後清掉。

## 不直覺的地方

- **decoder 不用 fp16，encoder 才用 fp16。** 用了 KV cache 之後，每步約 12 ms，瓶頸是每步 dispatch 的固定成本，不是運算量。fp16 decoder 沒有變快，只省下載量；fp16 encoder 則快約 27%，讀出的字完全相同。沒有 `shader-f16` 的 GPU 用 fp32 encoder。
- **自己轉 fp16 decoder 時要修 Cast。** `present_*` 既是圖的輸出、又被圖裡的 attention 讀，onnxconverter-common 插的轉回 fp32 的 Cast 會讓 session 建不起來；onnx-community 發布的 fp16 decoder 多半也是這個 bug。目前不用 fp16 decoder，留著以免有人重踩。

## 不採用的做法

- **繼續用 onnx-community 的 decoder、只做 #316（讀完的框退出 batch）。** 每步的固定成本（cross-attention 的 K/V）還在，省不了多少。
- **用 Optimum 或 transformers.js 的 merged decoder。** Optimum 不支援這個模型的帶 past 匯出；transformers.js 需要的 `decoder_model_merged.onnx` 也因此不存在。
