FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# Copy package manifests and install dependencies
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

EXPOSE 4000

ENV PORT=4000

CMD ["npm", "start"]
