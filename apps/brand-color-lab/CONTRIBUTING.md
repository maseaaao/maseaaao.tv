# Contributing

Small, focused issues and pull requests are welcome. Describe what you want to change, the expected behavior, and any browser-specific details.

1. Keep the app usable by opening `index.html` directly, without a build or network connection.
2. Preserve stored palette IDs, import compatibility, favorites and virtualization.
3. Keep user data local. Do not add tracking or publish real history exports.
4. Retain the Unbounded font attribution and license when editing or redistributing the embedded font.
5. Run `npm test` and `npm run format:check` before submitting a change. Check clipboard access and downloads in your own browser when changing those features.

The interface currently uses Russian labels; documentation is in English. Please explain larger UI changes in the pull request before introducing additional dependencies.
