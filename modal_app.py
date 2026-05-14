import os
import subprocess
from modal import App, Image, Secret, web_server

# 1. Define the App (Official 1.0 pattern)
app = App("eixora-backend")

# 2. Build the Environment
image = (
    Image.debian_slim()
    .apt_install("curl", "ffmpeg", "python3")
    # Install Node.js 20 and yt-dlp binary (latest)
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp",
        "chmod a+rx /usr/local/bin/yt-dlp"
    )
    # Add your files (Official pattern for bundling code)
    # Copy Node dependencies (using copy=True so we can run npm install)
    .add_local_file("package.json", "/app/package.json", copy=True)
    .add_local_dir("prisma", "/app/prisma", copy=True)
    # Install NPM packages and generate Prisma Client
    .run_commands("cd /app && npm install && npx prisma generate")
    # Finally, mount the rest of your code for runtime
    # We ignore node_modules and uploads to avoid overwriting the image's build
    .add_local_dir(".", remote_path="/app", ignore=["node_modules", "uploads", ".next", ".git"])
)

# 3. Start the Express Server
@app.function(
    image=image, 
    secrets=[Secret.from_dotenv()], 
    min_containers=1 # Ensures fast response
)
@web_server(8000, startup_timeout=60)
def express_server():
    env = os.environ.copy()
    env["PORT"] = "8000"
    
    print("🚀 [MODAL] Starting Eixora Node.js Server...")
    
    # Use Popen (non-blocking) so Modal can finish initialization
    # and start proxying traffic to port 8000
    subprocess.Popen(["node", "index.js"], cwd="/app", env=env)
