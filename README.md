# Toastyfiles
Toastyfiles is a filetrasfer website that uses WebRTC to send files P2P. Recommended max filetransfer size is 1-2GB, this is especially for firefox. The limiting factor for file size is your available system memory.

If you just want to use a working version of the program, head over to [toastyfiles.com](https://toastyfiles.com). But if you want to change (clean up my ugly react code), feel free to download the source code and poke around. You can host your own toastyfiles too if you want!

## Installation
- Make sure you have yarn installed: `npm install --global yarn`
- Run `yarn build`
- Put the contents of the build directory in your webroot
- Start the python script with `python3 main.py`
- If you are hosting this somewhere other than `localhost`, make sure you proxy /ws to wherever the python script is running. The default port of the python script is `8765`

## Development
- Make sure you have yarn installed: `npm install --global yarn`
- Run `yarn start`
- The dev environment should now be available at `localhost:3000`
- All code is in App.js (I know, ew)