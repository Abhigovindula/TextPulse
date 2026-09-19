# 🧠 TextPulse

> Understand the emotion behind every word.

TextPulse is an end-to-end NLP emotion classification system that uses deep learning to classify text into **six emotions**: Sadness, Joy, Love, Anger, Fear, and Surprise.

🔗 **Live Demo:** https://textpulse-1.onrender.com/

## 📊 Dataset

TextPulse uses the **DAIR.AI Emotion Dataset** from Hugging Face.

https://huggingface.co/datasets/dair-ai/emotion

## ✨ Features

- Six-class emotion classification
- Text preprocessing, tokenization and sequence padding
- Embedding-based NLP pipeline
- Comparison of RNN, LSTM, GRU and Bi-GRU architectures
- Class-weighted training and early stopping
- FastAPI inference backend
- Interactive HTML/CSS/JavaScript frontend
- Deployed on Render

## 🧠 Model

Four recurrent architectures were evaluated:

| Model | Test Accuracy |
|---|---:|
| RNN | 28.40% |
| LSTM | 14.10% |
| GRU | 13.80% |
| **Bi-GRU** | **91.70%** |

The **Bi-GRU** model was selected as the final model and is used by the deployed application.

**Bi-GRU Test Loss:** 0.2367  
**Bi-GRU Test Accuracy:** 91.7%

## 🔄 Pipeline

```text
Text Input
    ↓
Preprocessing
    ↓
Tokenization
    ↓
Sequence Padding
    ↓
Embedding
    ↓
Bi-GRU
    ↓
Emotion Prediction
```

## 🛠️ Tech Stack

**Machine Learning:** Python, TensorFlow, Keras, NumPy, Pandas, Scikit-learn

**NLP:** Hugging Face Datasets, Tokenization, Sequence Padding, Embeddings

**Visualization:** Matplotlib, Seaborn

**Backend:** FastAPI, Uvicorn, Pydantic

**Frontend:** HTML, CSS, JavaScript

**Deployment:** Render

## 📁 Project Structure

```text
TextPulse/
├── Artifacts/
│   ├── BiGRU_Modle.keras
│   └── tokenizer.pkl
├── static/
│   ├── index.html
│   ├── script.js
│   └── style.css
├── main.py
├── requirements.txt
└── Sentiment_Analysis.ipynb
```
