# An open-source System One model on the CPU, for a librocat that runs
# offline: Von (github.com/wfzyx/von, Apache-2.0), a 395M-parameter decision
# model that speaks TypeSafe's /v1/systemone. Its weights download from
# Hugging Face on the first request and stay in the volume.
# Measured on librocat's own questions (SELF_HOSTING.md): well below Jev.
FROM python:3.12-slim
# PyTorch's CPU build first: from PyPI, pip would bring CUDA's, gigabytes of it.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch \
 && pip install --no-cache-dir "von-sdk==1.3.1"
ENV HF_HOME=/models
EXPOSE 8000
CMD ["von", "serve", "--host", "0.0.0.0", "--port", "8000"]
