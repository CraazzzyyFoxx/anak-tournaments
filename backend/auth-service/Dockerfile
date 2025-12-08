# Auth Service Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# Copy shared library (needed for models)
COPY ../shared /app/shared

# Copy application code
COPY . .

# Expose port
EXPOSE 8001

# Run the application
CMD ["python", "main.py"]
