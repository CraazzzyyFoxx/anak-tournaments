"""What a Components V2 message is filled with, as every renderer in this service says it.

Moved here from the shared event schema: no other service builds a card any
more, so the shape is this service's own. ``src/interactions/cards.py`` turns
it into discord.py components; the renderers under ``src/render`` produce it
from the platform's rows.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

__all__ = (
    "DISCORD_CARD_TEXT_LIMIT",
    "DiscordAction",
    "DiscordActionButton",
    "DiscordButton",
    "DiscordCard",
    "DiscordLinkButton",
)

#: Discord's cap on the text of every TextDisplay in one Components V2 message.
DISCORD_CARD_TEXT_LIMIT = 4000


#: The actions this service answers itself (``src/interactions/actions.py``
#: says what each one calls). A literal rather than a string so a renderer
#: cannot put a button on a card that the dispatcher could only answer "unknown".
DiscordAction = Literal[
    "invite.accept",
    "invite.decline",
    "check_in",
    "registration.view",
    "notifications.menu",
    "notifications.mute",
    "mix.join",
    "mix.leave",
    "mix.roles",
    "mix.setup",
    "mix.seat_set",
    "mix.away",
    "mix.back",
    "voice.move",
    "voice.return",
    "voice.move_confirm",
    "voice.return_confirm",
]

#: An emoji by name, as ``src.ui.EMOJI`` spells it (``tank``, ``div_gold_3``);
#: ``src/interactions/emoji.py`` resolves it to the uploaded application emoji.
_EMOJI_NAME = r"^[a-z0-9_]{1,28}$"


class DiscordLinkButton(BaseModel):
    """A link button: Discord opens ``url`` itself, so the bot handles no interaction."""

    type: Literal["link"] = "link"
    label: str = Field(min_length=1, max_length=80)
    url: str = Field(max_length=512, pattern=r"^https?://")
    emoji: str | None = Field(default=None, pattern=_EMOJI_NAME)


class DiscordActionButton(BaseModel):
    """A button the bot answers itself, acting as whoever clicked it.

    It names *what* and *on which object*, never *who*: the clicker comes from
    the interaction Discord signs, and the bot acts only for an account that
    linked that Discord user. The target RPC then authorizes as it does for the
    site, so a button can never do more than its clicker could there.
    """

    type: Literal["action"] = "action"
    label: str = Field(min_length=1, max_length=80)
    action: DiscordAction
    #: The object acted on: an invite id, a tournament id, a preference group.
    target: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    style: Literal["primary", "secondary", "success", "danger"] = "secondary"
    emoji: str | None = Field(default=None, pattern=_EMOJI_NAME)
    #: Shown greyed out: the card says the action exists but is not open now.
    disabled: bool = False


DiscordButton = Annotated[DiscordLinkButton | DiscordActionButton, Field(discriminator="type")]


class DiscordCard(BaseModel):
    """One Components V2 message: an accent-coloured container laid out as

    ``text`` (with ``thumbnail_url`` beside it), a divider, ``details``,
    ``image_url`` as a full-width picture and the ``answers`` row, with one
    action row per entry of ``rows`` under the container rather than in it.
    ``answers`` holds the card's one-click answers, ``rows`` where to read more
    and how to stop hearing it.
    Both texts are Discord markdown, already escaped by the renderer, and may
    carry ``:owt_<name>:`` emoji shortcodes (``src.ui``).
    """

    accent_color: int | None = Field(default=None, ge=0, le=0xFFFFFF)
    text: str = Field(min_length=1)
    details: str | None = None
    thumbnail_url: str | None = Field(default=None, max_length=2048, pattern=r"^https?://")
    #: A picture the card is *about* (an encounter's OpenGraph image), not its
    #: icon: Discord shows it full width, fetching the URL itself.
    #: ``attachment://<filename>`` shows a PNG the renderer draws and uploads
    #: with the message.
    image_url: str | None = Field(default=None, max_length=2048, pattern=r"^(https?|attachment)://")
    answers: list[DiscordButton] = Field(default_factory=list, max_length=5)
    # Discord's own caps: five buttons to a row, five rows to a message.
    rows: list[Annotated[list[DiscordButton], Field(min_length=1, max_length=5)]] = Field(
        default_factory=list, max_length=5
    )

    @model_validator(mode="after")
    def _fits_one_message(self) -> DiscordCard:
        # Discord answers 400 past this, which is a DLQ entry rather than a message.
        if len(self.text) + len(self.details or "") > DISCORD_CARD_TEXT_LIMIT:
            raise ValueError(f"card text exceeds Discord's {DISCORD_CARD_TEXT_LIMIT}-character limit")
        return self

    @property
    def attachment_name(self) -> str | None:
        """The file the card shows from its own message, ``None`` for a URL or no picture."""
        prefix = "attachment://"
        return self.image_url[len(prefix) :] if self.image_url and self.image_url.startswith(prefix) else None
