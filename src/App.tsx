import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./components/Icons";
import { LockScreen } from "./components/LockScreen";
import { UploadModal } from "./components/UploadModal";
import { VideoPlayer } from "./components/VideoPlayer";
import { formatSeconds } from "./lib/youtube";
import { deleteLocalVideoBlob } from "./lib/idb";
import { DEFAULT_CATEGORIES, type AuthStatus, type NavView, type Video, type VideoChapter } from "./types";

type SortMode = "Recently added" | "A–Z" | "Highest match" | "Year (newest)";
type LibraryFilter = "All" | "Pinned" | "Favorites" | "YouTube" | "Uploaded" | "Unwatched";

type CardActions = {
  toggleSaved: (video: Video) => void;
  toggleLiked: (video: Video) => void;
  onPlay: (video: Video) => void;
  onDetails: (video: Video) => void;
};

function NavBar({
  view,
  categories,
  onView,
  query,
  setQuery,
  onOpenUpload,
  onSurpriseMe,
  onExportBackup,
  videoCount,
  likedCount,
  hasPrototypes,
  onClearPrototypes,
  onLock,
  storageMode,
}: {
  view: NavView;
  categories: string[];
  onView: (view: NavView) => void;
  query: string;
  setQuery: (q: string) => void;
  onOpenUpload: (tab?: "youtube" | "file") => void;
  onSurpriseMe: () => void;
  onExportBackup: () => void;
  videoCount: number;
  likedCount: number;
  hasPrototypes: boolean;
  onClearPrototypes: () => void;
  onLock: () => void;
  storageMode: "blob" | "local";
}) {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onOutsideClick = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  const navItems: NavView[] = useMemo(
    () => ["Home", ...categories, "New & Popular", "My List"],
    [categories],
  );

  const navigate = (item: NavView) => {
    onView(item);
    setQuery("");
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <header className={`nav ${scrolled ? "nav--solid" : ""}`}>
      <button className="logo" onClick={() => navigate("Home")} aria-label="MYFLIX home">
        MYFLIX
      </button>

      <button
        className="mobile-browse"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-expanded={menuOpen}
      >
        <Icon name="menu" size={20} /> Browse <Icon name="down" size={15} />
      </button>

      <nav
        className={`nav-links ${menuOpen ? "nav-links--open" : ""}`}
        aria-label="Main navigation"
      >
        {navItems.map((item) => (
          <button
            key={item}
            onClick={() => navigate(item)}
            className={view === item && !query ? "active" : ""}
          >
            {item}
          </button>
        ))}
      </nav>

      <div className="nav-actions">
        <div className={`search-box ${searchOpen || query ? "search-box--open" : ""}`}>
          <button aria-label="Search" onClick={() => setSearchOpen(true)}>
            <Icon name="search" size={21} />
          </button>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            placeholder="Titles, categories, descriptions"
            aria-label="Search videos"
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <Icon name="close" size={18} />
            </button>
          )}
        </div>

        {videoCount > 0 && (
          <button
            className="nav-shuffle-btn"
            onClick={onSurpriseMe}
            aria-label="Surprise me with a random video"
            title="Play a random video"
          >
            <Icon name="shuffle" size={17} />
            <span>Surprise Me</span>
          </button>
        )}

        <button className="nav-upload-btn" onClick={() => onOpenUpload("youtube")} aria-label="Add Video">
          <Icon name="plus" size={18} />
          <span>Add Video</span>
        </button>

        <div className="profile-menu-wrap" ref={profileRef}>
          <button
            className="profile"
            aria-label="Account and library menu"
            aria-expanded={profileOpen}
            onClick={() => setProfileOpen((prev) => !prev)}
          >
            <span className="avatar">M</span>
            <Icon name="down" size={15} />
          </button>

          {profileOpen && (
            <div className="profile-dropdown" role="menu">
              <div className="profile-status">
                <span className="status-dot" />
                <span>{storageMode === "blob" ? "Cloud Synced" : "Local Dev Mode"}</span>
              </div>
              <div className="profile-stats">
                <span>{videoCount} {videoCount === 1 ? "video" : "videos"}</span>
                <span>•</span>
                <span>{likedCount} {likedCount === 1 ? "favorite" : "favorites"}</span>
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setProfileOpen(false);
                  onOpenUpload("youtube");
                }}
              >
                <Icon name="upload" size={16} /> Add / Upload Video
              </button>
              {videoCount > 0 && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    onExportBackup();
                  }}
                >
                  <Icon name="download" size={16} /> Export Catalog Backup
                </button>
              )}
              {hasPrototypes && (
                <button
                  role="menuitem"
                  onClick={() => {
                    setProfileOpen(false);
                    onClearPrototypes();
                  }}
                >
                  <Icon name="trash" size={16} /> Clear Prototype Demos
                </button>
              )}
              <button
                role="menuitem"
                className="danger"
                onClick={() => {
                  setProfileOpen(false);
                  onLock();
                }}
              >
                <Icon name="lock" size={16} /> Lock Myflix
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function WelcomeBillboard({
  onOpenUpload,
}: {
  onOpenUpload: (tab?: "youtube" | "file") => void;
}) {
  return (
    <main className="welcome-stage">
      <div className="welcome-spotlight" />
      <section className="welcome-hero">
        <span className="eyebrow">
          <span className="mini-logo">M</span> MYFLIX PERSONAL VAULT
        </span>
        <h1>Your Personal Cinema Starts Here.</h1>
        <p>
          No dummy thumbnails. Build your own Netflix-grade vault from scratch—paste Unlisted
          YouTube links for unlimited free streaming or drop video files and pick your exact
          thumbnail frame.
        </p>
        <div className="welcome-cta-row">
          <button className="button button--red" onClick={() => onOpenUpload("youtube")}>
            <Icon name="link" size={18} /> Add YouTube Video
          </button>
          <button className="button button--glass" onClick={() => onOpenUpload("file")}>
            <Icon name="upload" size={18} /> Upload Video File
          </button>
        </div>
      </section>

      <section className="welcome-cards" aria-label="Quick start features">
        <button
          type="button"
          className="welcome-card"
          onClick={() => onOpenUpload("youtube")}
        >
          <span className="welcome-card-icon">
            <Icon name="link" size={22} />
          </span>
          <strong>Unlimited YouTube Streaming</strong>
          <p>
            Paste any Unlisted or Public YouTube URL—titles auto-fill and you can pick from crisp
            built-in or custom frames.
          </p>
        </button>

        <button
          type="button"
          className="welcome-card"
          onClick={() => onOpenUpload("file")}
        >
          <span className="welcome-card-icon">
            <Icon name="camera" size={22} />
          </span>
          <strong>Drag, Drop & Scrub Any Frame</strong>
          <p>
            Drop an MP4, WebM, or MOV file to auto-sample frames or scrub to the exact second for a
            sharp custom cover.
          </p>
        </button>

        <div className="welcome-card welcome-card--static">
          <span className="welcome-card-icon">
            <Icon name="bookmark" size={22} />
          </span>
          <strong>Bookmarks, Queue & Device Sync</strong>
          <p>
            Bookmark favorite moments inside the player, pin spotlight videos, auto-resume where you
            left off, and play across any device.
          </p>
        </div>
      </section>
    </main>
  );
}

function getHeroImageCandidates(url?: string): string[] {
  if (!url) return [];
  // For YouTube thumbnails: prioritize crisp maxresdefault (HD 1080p/720p), then sddefault (640x480), then original
  if (url.includes("i.ytimg.com")) {
    const ytMatch = url.match(/https:\/\/i\.ytimg\.com\/vi\/([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
      const id = ytMatch[1];
      const list = [
        `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      ];
      return Array.from(new Set([list[0], list[1], url, list[2]]));
    }
  }
  if (url.includes("w=1200")) {
    return [url.replace("w=1200", "w=2000"), url];
  }
  return [url];
}

function Hero({
  video,
  onPlay,
  onInfo,
}: {
  video: Video;
  onPlay: () => void;
  onInfo: () => void;
}) {
  const sourceBadge =
    video.pinned
      ? "PINNED SPOTLIGHT"
      : video.sourceType === "youtube"
        ? "YOUTUBE STREAM"
        : video.sourceType === "video"
          ? "UPLOADED VIDEO"
          : "MYFLIX ORIGINAL";

  const candidates = useMemo(() => getHeroImageCandidates(video.image), [video.image]);
  const [candidateIdx, setCandidateIdx] = useState(0);

  useEffect(() => {
    setCandidateIdx(0);
  }, [video.image]);

  const currentImage = candidates[candidateIdx] || "";

  const handleNextCandidate = () => {
    setCandidateIdx((prev) => (prev + 1 < candidates.length ? prev + 1 : prev));
  };

  return (
    <section className="hero">
      <div className="hero-backdrop" aria-hidden="true">
        {currentImage && (
          <img
            className="hero-backdrop-img"
            src={currentImage}
            alt=""
            onError={handleNextCandidate}
            onLoad={(e) => {
              // YouTube sends a 120x90 placeholder when maxres is absent
              if (currentImage.includes("maxresdefault") && e.currentTarget.naturalWidth <= 120) {
                handleNextCandidate();
              }
            }}
          />
        )}
        <div className="hero-shade" />
      </div>

      <div className="hero-content">
        <span className="eyebrow">
          <span className="mini-logo">M</span> {sourceBadge}
        </span>
        <h1 title={video.title}>{video.title}</h1>
        <div className="hero-meta">
          <strong>{video.match}% Match</strong>
          <span>{video.year}</span>
          <span>{video.duration}</span>
          <b>{video.category.toUpperCase()}</b>
        </div>
        {video.description && <p title={video.description}>{video.description}</p>}
        <div className="hero-actions">
          <button className="button button--light" onClick={onPlay}>
            <Icon name="play" /> Play
          </button>
          <button className="button button--glass" onClick={onInfo}>
            <Icon name="info" /> More Info
          </button>
        </div>
      </div>
      <span className="maturity">PRIVATE</span>
    </section>
  );
}

function RoundButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  active?: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      className={`round-button ${active ? "round-button--active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Icon name={icon} size={19} />
    </button>
  );
}

function VideoCard({
  video,
  actions,
  rank,
}: {
  video: Video;
  actions: CardActions;
  rank?: number;
}) {
  const saved = Boolean(video.added);
  const liked = Boolean(video.liked);
  const hasChapters = Boolean(video.chapters?.length);

  return (
    <article
      className={`video-card ${rank ? "rank-card" : ""}`}
      tabIndex={0}
      onClick={(e) => {
        if (
          window.matchMedia("(hover: none)").matches &&
          !(e.target as HTMLElement).closest("button")
        ) {
          actions.onDetails(video);
        }
      }}
    >
      {rank && <span className="rank-number">{rank}</span>}
      <div className="card-visual">
        {video.image ? (
          <img src={video.image} alt={`${video.title} video thumbnail`} loading="lazy" />
        ) : (
          <div className="card-fallback-poster">
            <Icon name="film" size={32} />
          </div>
        )}
        <div className="card-badges">
          {video.pinned && <span className="card-pin-badge" title="Pinned to Spotlight">★</span>}
          {hasChapters && (
            <span className="card-chapter-badge" title={`${video.chapters!.length} bookmarked moments`}>
              {video.chapters!.length}
            </span>
          )}
          {video.sourceType !== "prototype" && (
            <span className="card-source-badge">
              {video.sourceType === "youtube" ? "YT" : "HD"}
            </span>
          )}
        </div>
        {video.duration && video.duration !== "Video" && (
          <span className="card-duration-pill">{video.duration}</span>
        )}
        <span className="card-title">{video.title}</span>
        {video.progress !== undefined && video.progress > 0 && video.progress < 97 && (
          <span className="progress-track">
            <i style={{ width: `${video.progress}%` }} />
          </span>
        )}
      </div>
      <div className="card-panel">
        <div className="card-buttons">
          <RoundButton
            label={`Play ${video.title}`}
            icon="play"
            onClick={(e) => {
              e.stopPropagation();
              actions.onPlay(video);
            }}
          />
          <RoundButton
            label={saved ? "Remove from My List" : "Add to My List"}
            icon={saved ? "check" : "plus"}
            active={saved}
            onClick={(e) => {
              e.stopPropagation();
              actions.toggleSaved(video);
            }}
          />
          <RoundButton
            label={liked ? "Unlike" : "I like this"}
            icon="like"
            active={liked}
            onClick={(e) => {
              e.stopPropagation();
              actions.toggleLiked(video);
            }}
          />
          <span className="button-spacer" />
          <RoundButton
            label="More info"
            icon="down"
            onClick={(e) => {
              e.stopPropagation();
              actions.onDetails(video);
            }}
          />
        </div>
        <div className="card-meta">
          <strong>{video.match}% Match</strong>
          <span>{video.year}</span>
          <span>{video.duration}</span>
          <b>{video.sourceType === "youtube" ? "YT" : "HD"}</b>
        </div>
        <p>{video.tags.join(" • ")}</p>
      </div>
    </article>
  );
}

function ContentRow({
  title,
  videos,
  actions,
  onExplore,
}: {
  title: string;
  videos: Video[];
  actions: CardActions;
  onExplore?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  if (videos.length === 0) return null;

  const scroll = (direction: number) =>
    rowRef.current?.scrollBy({
      left: direction * rowRef.current.clientWidth * 0.85,
      behavior: "smooth",
    });

  return (
    <section className="content-row">
      <h2>
        {onExplore ? (
          <button className="row-heading-btn" onClick={onExplore}>
            {title}
            <span>
              Explore all <Icon name="right" size={15} />
            </span>
          </button>
        ) : (
          title
        )}
      </h2>
      <div className="row-frame">
        <button
          className="row-arrow row-arrow--left"
          onClick={() => scroll(-1)}
          aria-label={`Scroll ${title} left`}
        >
          <Icon name="left" size={34} />
        </button>
        <div className="card-strip" ref={rowRef}>
          {videos.map((video) => (
            <VideoCard key={`${title}-${video.id}`} video={video} actions={actions} />
          ))}
        </div>
        <button
          className="row-arrow row-arrow--right"
          onClick={() => scroll(1)}
          aria-label={`Scroll ${title} right`}
        >
          <Icon name="right" size={34} />
        </button>
      </div>
    </section>
  );
}

function VideoGrid({
  videos,
  actions,
  ranks,
}: {
  videos: Video[];
  actions: CardActions;
  ranks?: boolean;
}) {
  return (
    <div className={`video-grid ${ranks ? "video-grid--ranks" : ""}`}>
      {videos.map((video, i) => (
        <VideoCard
          key={video.id}
          video={video}
          actions={actions}
          rank={ranks ? i + 1 : undefined}
        />
      ))}
    </div>
  );
}

function sortVideos(list: Video[], sort: SortMode): Video[] {
  const copy = list.slice();
  if (sort === "A–Z") {
    return copy.sort((a, b) => a.title.localeCompare(b.title));
  }
  if (sort === "Highest match") {
    return copy.sort((a, b) => b.match - a.match);
  }
  if (sort === "Year (newest)") {
    return copy.sort((a, b) => b.year - a.year || b.createdAt.localeCompare(a.createdAt));
  }
  return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function BrowsePage({
  view,
  videos,
  actions,
  onOpenUpload,
}: {
  view: NavView;
  videos: Video[];
  actions: CardActions;
  onOpenUpload: (tab?: "youtube" | "file") => void;
}) {
  const [sort, setSort] = useState<SortMode>("Recently added");

  if (view === "New & Popular") {
    if (videos.length === 0) {
      return (
        <main className="library-page">
          <h1>New & Popular</h1>
          <div className="empty-state">
            <div className="empty-plus">
              <Icon name="film" size={40} />
            </div>
            <h2>No videos added yet</h2>
            <p>Add your first YouTube link or upload a clip to see your latest releases here.</p>
            <button className="button button--red empty-cta" onClick={() => onOpenUpload("youtube")}>
              <Icon name="plus" size={18} /> Add Video
            </button>
          </div>
        </main>
      );
    }

    const newest = sortVideos(videos, "Recently added").slice(0, 10);
    const ranked = videos
      .slice()
      .sort((a, b) => Number(Boolean(b.liked)) - Number(Boolean(a.liked)) || b.match - a.match)
      .slice(0, 10);
    return (
      <main className="library-page">
        <h1>New & Popular</h1>
        <h2>Latest additions</h2>
        <VideoGrid videos={newest} actions={actions} />
        <h2>Top picks in your library</h2>
        <VideoGrid videos={ranked} actions={actions} ranks />
      </main>
    );
  }

  const filtered =
    view === "My List"
      ? videos.filter((v) => v.added)
      : videos.filter((v) => v.category === view);
  const shown = sortVideos(filtered, sort);

  const playShuffled = () => {
    if (shown.length === 0) return;
    const pick = shown[Math.floor(Math.random() * shown.length)];
    actions.onPlay(pick);
  };

  return (
    <main className="library-page">
      <div className="page-heading">
        <h1>{view}</h1>
        <div className="page-heading-actions">
          {shown.length > 0 && (
            <>
              <button
                type="button"
                className="button button--light page-play-btn"
                onClick={() => actions.onPlay(shown[0])}
              >
                <Icon name="play" size={16} /> Play All
              </button>
              {shown.length > 1 && (
                <button
                  type="button"
                  className="button button--glass page-play-btn"
                  onClick={playShuffled}
                >
                  <Icon name="shuffle" size={16} /> Shuffle
                </button>
              )}
            </>
          )}
          {view !== "My List" && shown.length > 0 && (
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              aria-label="Sort videos"
            >
              <option>Recently added</option>
              <option>A–Z</option>
              <option>Highest match</option>
              <option>Year (newest)</option>
            </select>
          )}
        </div>
      </div>

      {shown.length ? (
        <VideoGrid videos={shown} actions={actions} />
      ) : (
        <div className="empty-state">
          <div className="empty-plus">
            <Icon name="plus" size={42} />
          </div>
          <h2>{view === "My List" ? "Your list is empty" : `No videos in ${view} yet`}</h2>
          <p>
            {view === "My List"
              ? "Add videos with the + button and they’ll sync across all your devices."
              : "Click Add Video to publish your first YouTube link or video into this category."}
          </p>
          <button className="button button--red empty-cta" onClick={() => onOpenUpload("youtube")}>
            <Icon name="plus" size={18} /> Add Video
          </button>
        </div>
      )}
    </main>
  );
}

function SearchResults({
  query,
  videos,
  actions,
}: {
  query: string;
  videos: Video[];
  actions: CardActions;
}) {
  const q = query.trim().toLowerCase();
  const matches = videos.filter((v) =>
    `${v.title} ${v.category} ${v.description} ${v.tags.join(" ")}`.toLowerCase().includes(q),
  );

  return (
    <main className="library-page search-results">
      <h1>Results for “{query}”</h1>
      {matches.length ? (
        <VideoGrid videos={matches} actions={actions} />
      ) : (
        <div className="empty-state">
          <Icon name="search" size={48} />
          <h2>No videos match your search.</h2>
          <p>Try different keywords or tags.</p>
        </div>
      )}
    </main>
  );
}

function DetailsModal({
  video,
  allVideos,
  toggleSaved,
  toggleLiked,
  togglePinned,
  onClose,
  onPlay,
  onPlayAtTime,
  onDetails,
  onEdit,
  onDelete,
  onClearProgress,
}: {
  video: Video;
  allVideos: Video[];
  toggleSaved: () => void;
  toggleLiked: () => void;
  togglePinned: () => void;
  onClose: () => void;
  onPlay: () => void;
  onPlayAtTime: (seconds: number) => void;
  onDetails: (v: Video) => void;
  onEdit: (v: Video) => void;
  onDelete: (id: string) => Promise<void>;
  onClearProgress: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setConfirmDelete(false);
  }, [video.id]);

  useEffect(() => {
    const close = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const related = allVideos
    .filter((v) => v.category === video.category && v.id !== video.id)
    .slice(0, 6);

  const saved = Boolean(video.added);
  const liked = Boolean(video.liked);
  const pinned = Boolean(video.pinned);
  const chapters = video.chapters ?? [];

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      role="presentation"
    >
      <section
        className="details-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${video.title} details`}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close details">
          <Icon name="close" />
        </button>

        <div
          className="modal-hero"
          style={video.image ? { backgroundImage: `url("${video.image}")` } : undefined}
        >
          <div>
            <h1>{video.title}</h1>
            <div className="modal-hero-actions">
              <button className="button button--light" onClick={onPlay}>
                <Icon name="play" />{" "}
                {video.progress && video.progress > 2 && video.progress < 97 ? "Resume" : "Play"}
              </button>
              <RoundButton
                label={saved ? "Remove from My List" : "Add to My List"}
                icon={saved ? "check" : "plus"}
                active={saved}
                onClick={toggleSaved}
              />
              <RoundButton
                label={liked ? "Unlike" : "I like this"}
                icon="like"
                active={liked}
                onClick={toggleLiked}
              />
              <RoundButton
                label={pinned ? "Unpin from Spotlight" : "Pin to Home Spotlight"}
                icon="star"
                active={pinned}
                onClick={togglePinned}
              />
              <RoundButton label="Edit video" icon="edit" onClick={() => onEdit(video)} />
              {!confirmDelete ? (
                <RoundButton
                  label="Delete video"
                  icon="trash"
                  onClick={() => setConfirmDelete(true)}
                />
              ) : (
                <button
                  className="button button--danger-confirm"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    await onDelete(video.id);
                    setDeleting(false);
                  }}
                >
                  {deleting ? "Deleting…" : "Confirm Delete"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="modal-body">
          <div className="modal-copy">
            <div className="modal-meta">
              <strong>{video.match}% Match</strong>
              <span>{video.year}</span>
              <span>{video.duration}</span>
              <b>{video.sourceType === "youtube" ? "YOUTUBE" : "HD"}</b>
            </div>
            <p>{video.description}</p>
            {video.progress !== undefined && video.progress > 0 && video.progress < 97 && (
              <div className="modal-progress-note">
                <span>Watched {video.progress}%</span>
                <button type="button" onClick={() => onClearProgress(video.id)}>
                  Reset watch progress
                </button>
              </div>
            )}
          </div>

          <aside>
            <p>
              <span>Category:</span> {video.category}
            </p>
            <p>
              <span>Tags:</span> {video.tags.join(", ")}
            </p>
            <p>
              <span>Source:</span>{" "}
              {video.sourceType === "youtube"
                ? "YouTube Stream"
                : video.sourceType === "video"
                  ? "Direct Video"
                  : "Prototype Demo"}
            </p>
          </aside>
        </div>

        {chapters.length > 0 && (
          <div className="modal-chapters">
            <h2>Bookmarked Moments</h2>
            <div className="modal-chapter-pills">
              {chapters.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  className="modal-chapter-pill"
                  onClick={() => onPlayAtTime(ch.time)}
                >
                  <span>{formatSeconds(ch.time)}</span>
                  <strong>{ch.label}</strong>
                </button>
              ))}
            </div>
          </div>
        )}

        {related.length > 0 && (
          <div className="more-like">
            <h2>More Like This</h2>
            <div>
              {related.map((item) => (
                <button key={item.id} onClick={() => onDetails(item)}>
                  <img src={item.image} alt="" />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Footer({ onOpenUpload }: { onOpenUpload: () => void }) {
  return (
    <footer>
      <div>
        <button type="button" onClick={onOpenUpload}>
          Add Video
        </button>
        <a href="#top">Back to Top</a>
        <span>Private Multi-Device Archive</span>
      </div>
      <p>© Myflix Personal Cinema</p>
    </footer>
  );
}

const LOCAL_STORAGE_CUSTOM_KEY = "myflix_custom_videos_v1";

function loadLocalCustomVideos(): Video[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_CUSTOM_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistLocalCustomVideos(videos: Video[]): void {
  try {
    const customOnly = videos.filter((v) => !v.isPrototype);
    localStorage.setItem(LOCAL_STORAGE_CUSTOM_KEY, JSON.stringify(customOnly));
  } catch {}
}

export default function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [categories, setCategories] = useState<string[]>([...DEFAULT_CATEGORIES]);
  const [blobAccess, setBlobAccess] = useState<"private" | "public">("private");
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  const [view, setView] = useState<NavView>("Home");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [initialSeekSeconds, setInitialSeekSeconds] = useState<number | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadInitialTab, setUploadInitialTab] = useState<"youtube" | "file">("youtube");
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("All");
  const [heroIndex, setHeroIndex] = useState(0);
  const [toast, setToast] = useState<string>("");
  const toastTimer = useRef<number | null>(null);

  const openUploadModal = useCallback((tab: "youtube" | "file" = "youtube") => {
    setEditingVideo(null);
    setUploadInitialTab(tab);
    setUploadModalOpen(true);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  }, []);

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/videos");
      if (res.status === 401) {
        setAuth((prev) => (prev ? { ...prev, authenticated: false } : prev));
        return;
      }
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        showToast(err.error || "Could not load video catalog.");
        setCatalogLoaded(true);
        return;
      }
      const data = (await res.json()) as {
        videos: Video[];
        categories: string[];
        storageMode: "blob" | "local";
        blobAccess?: "private" | "public";
      };
      let mergedVideos = data.videos;
      if (data.storageMode === "local") {
        const localCached = loadLocalCustomVideos();
        if (localCached.length > 0) {
          const map = new Map<string, Video>();
          for (const v of localCached) map.set(v.id, v);
          for (const v of data.videos) map.set(v.id, v);
          mergedVideos = Array.from(map.values());
        }
      }
      setVideos(mergedVideos);
      const allCategories = new Set(data.categories);
      for (const v of mergedVideos) {
        if (v.category) allCategories.add(v.category);
      }
      setCategories(Array.from(allCategories));
      if (data.blobAccess) setBlobAccess(data.blobAccess);
      setCatalogLoaded(true);
    } catch {
      showToast("Network error loading Myflix library.");
      setCatalogLoaded(true);
    }
  }, [showToast]);

  useEffect(() => {
    fetch("/api/auth")
      .then((res) => res.json())
      .then((status: AuthStatus & { blobAccess?: "private" | "public" }) => {
        setAuth(status);
        if (status.blobAccess) setBlobAccess(status.blobAccess);
        if (status.authenticated) {
          void fetchCatalog();
        }
      })
      .catch(() => {
        setAuth({ authenticated: false, configured: true, storageMode: "local" });
      });
  }, [fetchCatalog]);

  const handleUnlock = async (passcode: string) => {
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      let data: { authenticated?: boolean; error?: string } = {};
      try {
        data = (await res.json()) as { authenticated?: boolean; error?: string };
      } catch {
        return {
          ok: false,
          error: `Server error (${res.status}). Please check Vercel deployment logs.`,
        };
      }
      if (!res.ok || !data.authenticated) {
        return { ok: false, error: data.error || "Incorrect passcode." };
      }
      setAuth((prev) =>
        prev
          ? { ...prev, authenticated: true }
          : { authenticated: true, configured: true, storageMode: "local" },
      );
      setCatalogLoaded(false);
      await fetchCatalog();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Could not reach server.",
      };
    }
  };

  const handleLock = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setPlayingId(null);
    setSelectedId(null);
    setUploadModalOpen(false);
    setVideos([]);
    setCatalogLoaded(false);
    setAuth((prev) => (prev ? { ...prev, authenticated: false } : prev));
  };

  const patchVideo = useCallback(
    async (id: string, patch: Record<string, unknown>, quiet = false) => {
      const res = await fetch("/api/videos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) {
        if (!quiet) showToast("Could not sync change.");
        return;
      }
      const data = (await res.json()) as { video: Video; categories: string[] };
      setVideos((prev) => prev.map((v) => (v.id === id ? data.video : v)));
      setCategories(data.categories);
    },
    [showToast],
  );

  const toggleSaved = useCallback(
    (video: Video) => {
      const nextAdded = !video.added;
      setVideos((prev) => prev.map((v) => (v.id === video.id ? { ...v, added: nextAdded } : v)));
      showToast(nextAdded ? `Added "${video.title}" to My List` : `Removed from My List`);
      void patchVideo(video.id, { added: nextAdded });
    },
    [patchVideo, showToast],
  );

  const toggleLiked = useCallback(
    (video: Video) => {
      const nextLiked = !video.liked;
      setVideos((prev) => prev.map((v) => (v.id === video.id ? { ...v, liked: nextLiked } : v)));
      showToast(nextLiked ? `Liked "${video.title}"` : "Like removed");
      void patchVideo(video.id, { liked: nextLiked });
    },
    [patchVideo, showToast],
  );

  const togglePinned = useCallback(
    (video: Video) => {
      const nextPinned = !video.pinned;
      setVideos((prev) => prev.map((v) => (v.id === video.id ? { ...v, pinned: nextPinned } : v)));
      showToast(
        nextPinned ? `Pinned "${video.title}" to Spotlight ★` : `Removed from Spotlight`,
      );
      void patchVideo(video.id, { pinned: nextPinned });
    },
    [patchVideo, showToast],
  );

  const handleSaveChapters = useCallback(
    (id: string, chapters: VideoChapter[]) => {
      setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, chapters } : v)));
      showToast("Bookmarked moment synced!");
      void patchVideo(id, { chapters }, true);
    },
    [patchVideo, showToast],
  );

  const handleCaptureThumbnail = useCallback(
    (id: string, dataUrl: string) => {
      setVideos((prev) => prev.map((v) => (v.id === id ? { ...v, image: dataUrl } : v)));
      showToast("Updated cover thumbnail from current frame!");
      void patchVideo(id, { thumbnailDataUrl: dataUrl });
    },
    [patchVideo, showToast],
  );

  const handleSurpriseMe = useCallback(() => {
    if (videos.length === 0) return;
    const pool = videos.filter((v) => v.id !== playingId);
    const list = pool.length > 0 ? pool : videos;
    const pick = list[Math.floor(Math.random() * list.length)];
    setInitialSeekSeconds(null);
    setSelectedId(null);
    setPlayingId(pick.id);
    showToast(`Playing "${pick.title}"`);
  }, [playingId, showToast, videos]);

  const handleExportBackup = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      categories,
      videos: videos.filter((v) => !v.isPrototype),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `myflix-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Catalog backup downloaded.");
  }, [categories, showToast, videos]);

  const handleSaveProgress = useCallback(
    (
      id: string,
      progressPercent: number,
      progressSeconds: number,
      durationSeconds?: number,
      durationLabel?: string,
    ) => {
      setVideos((prev) =>
        prev.map((v) =>
          v.id === id
            ? {
                ...v,
                progress: progressPercent,
                progressSeconds,
                ...(durationSeconds ? { durationSeconds } : {}),
                ...(durationLabel ? { duration: durationLabel } : {}),
              }
            : v,
        ),
      );
      void patchVideo(
        id,
        {
          progress: progressPercent,
          progressSeconds,
          ...(durationSeconds ? { durationSeconds } : {}),
          ...(durationLabel ? { duration: durationLabel } : {}),
        },
        true,
      );
    },
    [patchVideo],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/videos?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        showToast("Failed to delete video.");
        return;
      }
      const data = (await res.json()) as { deletedId: string; categories: string[] };
      void deleteLocalVideoBlob(data.deletedId);
      setVideos((prev) => {
        const next = prev.filter((v) => v.id !== data.deletedId);
        persistLocalCustomVideos(next);
        return next;
      });
      setCategories(data.categories);
      setSelectedId(null);
      showToast("Video deleted.");
    },
    [showToast],
  );

  const handleClearPrototypes = useCallback(async () => {
    const res = await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "clear-prototypes" }),
    });
    if (!res.ok) {
      showToast("Could not remove demo items.");
      return;
    }
    const data = (await res.json()) as { videos: Video[]; categories: string[] };
    setVideos(data.videos);
    setCategories(data.categories);
    setHeroIndex(0);
    showToast("Prototype demo videos removed.");
  }, [showToast]);

  const actions = useMemo<CardActions>(
    () => ({
      toggleSaved,
      toggleLiked,
      onPlay: (v) => {
        setInitialSeekSeconds(null);
        setPlayingId(v.id);
      },
      onDetails: (v) => setSelectedId(v.id),
    }),
    [toggleLiked, toggleSaved],
  );

  const selected = useMemo(
    () => videos.find((v) => v.id === selectedId) ?? null,
    [videos, selectedId],
  );
  const playing = useMemo(
    () => videos.find((v) => v.id === playingId) ?? null,
    [videos, playingId],
  );

  const nextInQueue = useMemo(() => {
    if (!playing) return undefined;
    const sameCategory = videos.filter((v) => v.category === playing.category);
    const idx = sameCategory.findIndex((v) => v.id === playing.id);
    if (idx !== -1 && idx + 1 < sameCategory.length) return sameCategory[idx + 1];
    return videos.find((v) => v.id !== playing.id);
  }, [playing, videos]);

  const realVideos = useMemo(() => videos.filter((v) => !v.isPrototype), [videos]);
  const featuredPool = useMemo(() => {
    const base = realVideos.length > 0 ? realVideos : videos;
    const pinnedList = base.filter((v) => v.pinned);
    return (pinnedList.length > 0 ? pinnedList : base).slice(0, 5);
  }, [realVideos, videos]);

  useEffect(() => {
    if (featuredPool.length <= 1) {
      setHeroIndex(0);
      return;
    }
    const timer = setInterval(
      () => setHeroIndex((i) => (i + 1) % featuredPool.length),
      8000,
    );
    return () => clearInterval(timer);
  }, [featuredPool.length]);

  if (!auth) {
    return (
      <div className="app">
        <div className="loading-page">
          <div className="skeleton skeleton--hero" />
        </div>
      </div>
    );
  }

  if (!auth.authenticated) {
    return <LockScreen auth={auth} onUnlock={handleUnlock} />;
  }

  const featured = featuredPool[heroIndex % Math.max(1, featuredPool.length)];
  const continueWatching = videos.filter(
    (v) => v.progress !== undefined && v.progress > 0 && v.progress < 97,
  );
  const myList = videos.filter((v) => v.added);
  const favorites = videos.filter((v) => v.liked);
  const recentlyAdded = sortVideos(videos, "Recently added").slice(0, 12);
  const hasPrototypes = videos.some((v) => v.isPrototype);
  const filteredHomeVideos =
    libraryFilter === "All"
      ? videos
      : videos.filter((v) => {
          if (libraryFilter === "Pinned") return Boolean(v.pinned);
          if (libraryFilter === "Favorites") return Boolean(v.liked);
          if (libraryFilter === "YouTube") return v.sourceType === "youtube";
          if (libraryFilter === "Uploaded") return v.sourceType === "video";
          if (libraryFilter === "Unwatched") return !v.progress || v.progress < 5;
          return true;
        });

  return (
    <div className="app" id="top">
      <NavBar
        view={view}
        categories={categories}
        onView={setView}
        query={query}
        setQuery={setQuery}
        onOpenUpload={openUploadModal}
        onSurpriseMe={handleSurpriseMe}
        onExportBackup={handleExportBackup}
        videoCount={videos.length}
        likedCount={favorites.length}
        hasPrototypes={hasPrototypes}
        onClearPrototypes={handleClearPrototypes}
        onLock={handleLock}
        storageMode={auth.storageMode}
      />

      {!catalogLoaded ? (
        <div className="loading-page">
          <div className="skeleton skeleton--hero" />
          <div className="skeleton-row">
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="skeleton" key={i} />
            ))}
          </div>
        </div>
      ) : (
        <div className="page-fade" key={query ? "search" : view}>
          {query ? (
            <SearchResults query={query} videos={videos} actions={actions} />
          ) : view === "Home" ? (
            videos.length === 0 ? (
              <WelcomeBillboard onOpenUpload={openUploadModal} />
            ) : (
              <>
                {featured && (
                  <>
                    <Hero
                      key={featured.id}
                      video={featured}
                      onPlay={() => {
                        setInitialSeekSeconds(null);
                        setPlayingId(featured.id);
                      }}
                      onInfo={() => setSelectedId(featured.id)}
                    />
                    {featuredPool.length > 1 && (
                      <div className="hero-dots">
                        {featuredPool.map((item, i) => (
                          <button
                            key={item.id}
                            className={i === heroIndex % featuredPool.length ? "active" : ""}
                            onClick={() => setHeroIndex(i)}
                            aria-label={`Show feature ${i + 1}`}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}

                <main className="home-rows">
                  <div className="quick-filter-bar" role="toolbar" aria-label="Filter library">
                    {(
                      ["All", "Pinned", "Favorites", "YouTube", "Uploaded", "Unwatched"] as LibraryFilter[]
                    ).map((filterName) => (
                      <button
                        key={filterName}
                        type="button"
                        className={`filter-pill ${libraryFilter === filterName ? "active" : ""}`}
                        onClick={() => setLibraryFilter(filterName)}
                      >
                        {filterName === "Pinned"
                          ? "Pinned ★"
                          : filterName === "Favorites"
                            ? "Favorites ♥"
                            : filterName}
                      </button>
                    ))}
                  </div>

                  {libraryFilter !== "All" ? (
                    <section className="filtered-home-section">
                      <h2>
                        {libraryFilter} Videos ({filteredHomeVideos.length})
                      </h2>
                      {filteredHomeVideos.length > 0 ? (
                        <VideoGrid videos={filteredHomeVideos} actions={actions} />
                      ) : (
                        <div className="empty-state">
                          <Icon name="film" size={40} />
                          <h2>No {libraryFilter.toLowerCase()} videos yet</h2>
                          <p>Switch back to All or add more videos to your vault.</p>
                        </div>
                      )}
                    </section>
                  ) : (
                    <>
                      <ContentRow
                        title="Continue Watching"
                        videos={continueWatching}
                        actions={actions}
                      />
                      {favorites.length > 0 && (
                        <ContentRow
                          title="Favorites ♥"
                          videos={favorites}
                          actions={actions}
                        />
                      )}
                      <ContentRow
                        title="My List"
                        videos={myList}
                        actions={actions}
                        onExplore={() => setView("My List")}
                      />
                      {categories.map((cat) => (
                        <ContentRow
                          key={cat}
                          title={cat}
                          videos={videos.filter((v) => v.category === cat)}
                          actions={actions}
                          onExplore={() => setView(cat)}
                        />
                      ))}
                      <ContentRow
                        title="Recently Added"
                        videos={recentlyAdded}
                        actions={actions}
                        onExplore={() => setView("New & Popular")}
                      />
                    </>
                  )}
                </main>
              </>
            )
          ) : (
            <BrowsePage
              view={view}
              videos={videos}
              actions={actions}
              onOpenUpload={openUploadModal}
            />
          )}

          <Footer onOpenUpload={() => openUploadModal("youtube")} />
        </div>
      )}

      {selected && (
        <DetailsModal
          video={selected}
          allVideos={videos}
          toggleSaved={() => toggleSaved(selected)}
          toggleLiked={() => toggleLiked(selected)}
          togglePinned={() => togglePinned(selected)}
          onClose={() => setSelectedId(null)}
          onPlay={() => {
            setInitialSeekSeconds(null);
            setPlayingId(selected.id);
            setSelectedId(null);
          }}
          onPlayAtTime={(seconds) => {
            setInitialSeekSeconds(seconds);
            setPlayingId(selected.id);
            setSelectedId(null);
          }}
          onDetails={(v) => setSelectedId(v.id)}
          onEdit={(v) => {
            setSelectedId(null);
            setEditingVideo(v);
            setUploadModalOpen(true);
          }}
          onDelete={handleDelete}
          onClearProgress={(id) => {
            setVideos((prev) =>
              prev.map((v) =>
                v.id === id ? { ...v, progress: undefined, progressSeconds: undefined } : v,
              ),
            );
            void patchVideo(id, { progress: null, progressSeconds: null });
            showToast("Watch progress cleared.");
          }}
        />
      )}

      {uploadModalOpen && (
        <UploadModal
          categories={categories}
          storageMode={auth.storageMode}
          blobAccess={blobAccess}
          editingVideo={editingVideo}
          initialTab={uploadInitialTab}
          onClose={() => {
            setUploadModalOpen(false);
            setEditingVideo(null);
          }}
          onSaved={(savedVideo, mode) => {
            if (mode === "edit") {
              setVideos((prev) => {
                const next = prev.map((v) => (v.id === savedVideo.id ? savedVideo : v));
                persistLocalCustomVideos(next);
                return next;
              });
              showToast(`Updated "${savedVideo.title}"`);
            } else {
              setVideos((prev) => {
                const next = [savedVideo, ...prev.filter((v) => v.id !== savedVideo.id)];
                persistLocalCustomVideos(next);
                return next;
              });
              showToast(`Published "${savedVideo.title}" to Myflix!`);
            }
            if (!categories.includes(savedVideo.category)) {
              setCategories((prev) => [...prev, savedVideo.category]);
            }
          }}
        />
      )}

      {playing && (
        <VideoPlayer
          video={playing}
          nextVideo={nextInQueue}
          initialSeekSeconds={initialSeekSeconds}
          onPlayNext={(next) => {
            setInitialSeekSeconds(null);
            setPlayingId(next.id);
          }}
          onSaveProgress={handleSaveProgress}
          onSaveChapters={handleSaveChapters}
          onCaptureThumbnail={handleCaptureThumbnail}
          onClose={() => {
            setInitialSeekSeconds(null);
            setPlayingId(null);
          }}
        />
      )}

      {toast && (
        <div className="myflix-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
