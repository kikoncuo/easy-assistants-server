# Base stage for dependencies
FROM oven/bun:latest as builder

# Set the working directory in the builder stage
WORKDIR /app

# Copy package files required for installations
COPY package.json bun.lockb* ./

# Install dependencies in a separate layer to leverage Docker cache
RUN bun install --production

# Final stage to create the executable image
FROM oven/bun:latest

# Arguments that can be passed during the build step
ARG OPENAI_API_KEY
ARG TAVILY_API_KEY
ARG LANGCHAIN_API_KEY
ARG LANGCHAIN_PROJECT
ARG LANGCHAIN_TRACING_V2
ARG GROQ_API_KEY
ARG ANTHROPIC_API_KEY
ARG BUN_ENV

# Environment variables based on ARG to make them persistent
ENV OPENAI_API_KEY=$OPENAI_API_KEY \
    TAVILY_API_KEY=$TAVILY_API_KEY \
    LANGCHAIN_API_KEY=$LANGCHAIN_API_KEY \
    LANGCHAIN_PROJECT=$LANGCHAIN_PROJECT \
    LANGCHAIN_TRACING_V2=$LANGCHAIN_TRACING_V2 \
    GROQ_API_KEY=$GROQ_API_KEY \
    ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
    BUN_ENV=$BUN_ENV

# Set the working directory in the final image
WORKDIR /usr/src/app

# Copy the installed dependencies from the builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy the rest of your application source code
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Command to run the application
CMD ["bun", "src/server.ts"]
