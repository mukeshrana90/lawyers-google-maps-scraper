FROM apify/actor-node-playwright-chrome:20

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY . ./

CMD ["node", "src/main.js"]
