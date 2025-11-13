FROM public.ecr.aws/lambda/nodejs:20

# Install production dependencies
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application source
COPY src/ ./src/
COPY projectstructure ./projectstructure
COPY acquisitionstructure ./acquisitionstructure

# Lambda entrypoint
CMD ["src/index.handler"]
