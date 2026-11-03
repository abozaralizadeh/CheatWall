# Logical flows

These are the main flows of the first version.

## 1. Making a poster

1. You type a topic and optionally pick a level.
2. The server checks the input, your limit and the daily spend cap.
3. It saves a poster record and sends you to the poster's private link straight away.
4. A background worker does the job while the page shows progress.
5. When it's ready, the page shows the preview and download buttons.

Because the link exists from the start, you can close the tab and come back.

```mermaid
sequenceDiagram
    actor Person
    participant Site
    participant Server
    participant Worker
    participant AI as AI model
    Person->>Site: Types topic, presses Create
    Site->>Server: Create poster
    Server->>Server: Check input, limit and daily cap
    Server-->>Site: Poster link
    Site->>Server: Ask for status every 2 seconds
    Worker->>AI: Check topic, write, review
    AI-->>Worker: Poster content
    Worker->>Worker: Draw and fit, export files
    Server-->>Site: Status is ready
    Site-->>Person: Preview and downloads
```

## 2. The job pipeline

1. **Safety check.** Is this a topic we'll make a poster for? If not, stop with a plain reason.
2. **Write.** The AI returns poster content in our structured format.
3. **Validate.** Code checks the structure. One retry if it fails.
4. **Review.** A second AI pass checks facts and fixes or removes anything shaky.
5. **Fit.** The content is drawn and fitted to the page (flow 3).
6. **Export.** PDF and PNG are saved, and the status becomes ready.

```mermaid
flowchart TD
    A[Queued] --> B{Topic allowed?}
    B -- No --> R[Refused, reason shown]
    B -- Yes --> C[AI writes content]
    C --> D{Valid structure?}
    D -- No, first time --> C
    D -- No, second time --> F[Failed]
    D -- Yes --> E[AI reviews content]
    E --> G[Draw and fit to page]
    G --> H{Fits?}
    H -- No --> I[AI shortens content]
    I --> G
    H -- Yes --> J[Export PDF and PNG]
    J --> K[Ready]
    H -- Still no after 2 tries --> F
```

If the AI model itself declines a request, that counts as Refused. If the server restarts mid-job, the worker picks up unfinished jobs from the start of the job. Failed posters don't count against your limit.

## 3. Fitting content to the page

The poster has to fill the page, with nothing cut off and no big gaps.

1. Draw the content in the chosen template at the largest text size.
2. Measure whether it overflows.
3. Step the text size down until it fits, stopping at the smallest readable size.
4. If it still overflows, ask the AI to cut it by the measured amount.
5. If the page ends up too empty, spacing grows to fill it.

```mermaid
flowchart TD
    A[Draw at largest size] --> B{Overflows?}
    B -- No --> F[Spread spacing to fill the page]
    B -- Yes --> C{At smallest size?}
    C -- No --> D[Step text size down]
    D --> A2[Redraw]
    A2 --> B
    C -- Yes --> E[Ask AI to shorten]
    E --> A
    F --> G[Done]
```

## 4. Changing the colour theme

1. You pick another theme on the poster screen.
2. The worker redraws the saved content and exports new files.
3. The preview updates.

There's no AI call, so it's free and doesn't count against your limit. The fit stays the same because themes only change colours.

## 5. Limits and the daily cap

1. A salted hash of the IP address identifies a visitor for the day. The salt changes daily.
2. Three posters a day per visitor.
3. Before each job the server compares today's spend with the cap.
4. Over the cap, the site says it's full for today and to come back tomorrow.

```mermaid
flowchart TD
    A[Create request] --> B{Topic valid?}
    B -- No --> X[Show input error]
    B -- Yes --> C{Under visitor limit?}
    C -- No --> Y[Show limit message]
    C -- Yes --> D{Under daily cap?}
    D -- No --> Z[Show full for today]
    D -- Yes --> E[Queue the job]
```

## 6. Opening a poster later

1. Anyone with the private link can see the poster and download it.
2. After 30 days a nightly job deletes the files and clears the content.
3. The link then shows an expired page with a button to make it again.

## 7. Setting up and updating the VM

The same script does both jobs.

```mermaid
flowchart TD
    A[Run setup_service.sh] --> B[Install system packages, Node and Chromium]
    B --> C[Install dependencies and build]
    C --> D[Run database updates]
    D --> E[Write and enable cheatwall.service]
    E --> F[Restart the service]
    F --> G[Check the health page]
```
