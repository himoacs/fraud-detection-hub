FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy SAM SDK stub
COPY solace_agent_mesh/ ./solace_agent_mesh/

# Copy agent code (set via build arg)
ARG AGENT_NAME
COPY ${AGENT_NAME}/ ./agent/

# Set Python path
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# Run agent
CMD ["python", "agent/agent.py"]
