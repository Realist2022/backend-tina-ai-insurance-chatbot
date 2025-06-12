# Use an official Node.js runtime as a parent image
FROM node:22-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install application dependencies
RUN npm install

# Copy the rest of your application's source code
COPY . .

# Your app runs on a port defined in the .env file.
# Let's assume it's 3000 for this example. Expose it.
EXPOSE 3000

# Define the command to run your app
CMD [ "node", "server.js" ]