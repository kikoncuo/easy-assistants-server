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
