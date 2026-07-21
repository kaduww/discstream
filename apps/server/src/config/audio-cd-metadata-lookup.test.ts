import { describe, expect, it } from "vitest";
import { metadataFromMusicBrainzResponse, parseDiscIdCommandOutput } from "./audio-cd-metadata-lookup.js";

describe("audio CD metadata lookup", () => {
  it("extracts Disc ID and TOC from command output", () => {
    expect(
      parseDiscIdCommandOutput(
        "Disc ID: I5l9cCSFccLKFEKS.7wqSZAorPU-\nTOC: 1 2 525 150 300\n"
      )
    ).toEqual({
      discId: "I5l9cCSFccLKFEKS.7wqSZAorPU-",
      toc: "1 2 525 150 300"
    });
  });

  it("maps MusicBrainz release candidates into Audio CD metadata", () => {
    const result = metadataFromMusicBrainzResponse(
      {
        releases: [
          {
            id: "release-short",
            title: "Single Disc Mismatch",
            media: [
              {
                format: "CD",
                "track-count": 1,
                tracks: [
                  {
                    position: 1,
                    title: "Intro"
                  }
                ]
              }
            ]
          },
          {
            id: "release-1",
            title: "Live After Death",
            "artist-credit": [
              {
                name: "Iron Maiden"
              }
            ],
            "cover-art-archive": {
              front: true
            },
            media: [
              {
                format: "CD",
                "track-count": 2,
                tracks: [
                  {
                    position: 1,
                    title: "Intro"
                  },
                  {
                    number: "2",
                    recording: {
                      title: "Aces High",
                      "artist-credit": [
                        {
                          name: "Iron Maiden"
                        }
                      ]
                    }
                  }
                ]
              }
            ]
          }
        ]
      },
      2
    );

    expect(result.candidateCount).toBe(2);
    expect(result.candidates.map((candidate) => candidate.musicBrainzReleaseId)).toEqual(["release-short", "release-1"]);
    expect(result.metadata).toMatchObject({
      albumTitle: "Live After Death",
      albumArtist: "Iron Maiden",
      coverUrl: "https://coverartarchive.org/release/release-1/front-250",
      musicBrainzReleaseId: "release-1",
      tracks: [
        {
          number: 1,
          title: "Intro"
        },
        {
          number: 2,
          title: "Aces High",
          artist: "Iron Maiden"
        }
      ]
    });
  });
});
