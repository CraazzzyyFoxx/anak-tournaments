# Every ORM model from the shared library, so ``from src import models;
# models.Tournament`` works.
from shared.models.achievements.achievement import *
from shared.models.analytics.analytics import *
from shared.models.balancer.balance import *
from shared.models.catalog.entity import *
from shared.models.catalog.role import *
from shared.models.division_grid.division_grid import *
from shared.models.encounter import *
from shared.models.identity.auth_user import *
from shared.models.identity.social import *
from shared.models.identity.user import *
from shared.models.identity.user_merge_audit import *
from shared.models.registration.registration import *
from shared.models.stats import *
from shared.models.tenancy.workspace import *
from shared.models.tournament.challonge import *
from shared.models.tournament.encounter_link import *
from shared.models.tournament.stage import *
from shared.models.tournament.standings import *
from shared.models.tournament.team import *
from shared.models.tournament.tournament import *
