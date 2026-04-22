FROM python:3.11-slim

# System deps for OpenCV headless + wget for model downloads
RUN apt-get update && \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 wget && \
    rm -rf /var/lib/apt/lists/*

# Only install Pillow (required) - ALICE handles all other deps
# At first start via Settings > System, adapting to GPU/CPU automatically
RUN pip install --no-cache-dir Pillow

WORKDIR /app
COPY alice.py .

EXPOSE 8080

ENTRYPOINT ["python3", "alice.py", "--port", "8080"]
