FROM node:18-alpine

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy the entire project
COPY . .

# Generate Prisma clients
RUN npm run generate

# Build the application
RUN npm run build

# Set environment to production
ENV NODE_ENV production

# Expose the API port
EXPOSE ${PORT}

# Verify the dist directory contents
RUN ls -R dist

# Start the application
CMD ["npm", "start"]