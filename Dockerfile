FROM node:18-bullseye-slim

# Install python3 which the project uses alongside node
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

RUN pip install requests

WORKDIR /usr/src/app

# Copy package files and install only production deps
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --only=production

# Copy app
COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
 
# Ensure stations.csv is present in the built image under the public directory
# (some builds may have excluded it previously). This copies the file from the
# project context into the image's `WORKDIR/public` so the node server can
# serve it statically.
COPY public/stations.csv public/stations.csv
RUN chmod 644 public/stations.csv || true
# Copy any audio assets (e.g. split flap sample) so the container can serve them
COPY public/audio public/audio
RUN chmod -R 644 public/audio || true
# Copy any image assets (e.g. logo) so the container can serve them
COPY public/assets public/assets
RUN chmod -R 644 public/assets || true

CMD ["npm", "start"]
