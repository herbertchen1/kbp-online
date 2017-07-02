import os
import json
import time
import math
import logging
from datetime import datetime
import pdb

import pytest
from tqdm import tqdm

import boto3
from botocore.exceptions import ClientError
from boto.mturk.question  import ExternalQuestion

from service.settings import MTURK_HOST, MTURK_TARGET
from . import db
from . import api
from django.core.mail import send_mail

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

MTURK_URL = MTURK_HOST+"/tasks/do"
_MTURK_PARAMS_FILE = os.path.join(os.path.dirname(__file__), 'params/mturk_params.json')
with open(_MTURK_PARAMS_FILE) as f:
    _MTURK_PARAMS = json.load(f)

_MTURK_CONFIG_FILE = os.path.join(os.path.dirname(__file__), 'params/mturk_config.json')
with open(_MTURK_CONFIG_FILE) as f:
    _MTURK_CONFIG = json.load(f)

def connect(host_str=MTURK_TARGET, forced=False):
    """
    Connect to mechanical turk to sandbox or actual depending on
    @host_str with prompt for actual unless @forced
    """
    logger.info("Connecting to MTurk using credentials in %s and config in %s",
            os.environ.get("AWS_SHARED_CREDENTIALS_FILE"),
            os.environ.get("AWS_CONFIG_FILE"),)

    sandbox_endpoint_url = 'https://mturk-requester-sandbox.us-east-1.amazonaws.com'
    if  host_str == 'sandbox':
        mtc = boto3.client('mturk', 
                endpoint_url=sandbox_endpoint_url,
                aws_access_key_id = _MTURK_CONFIG["aws_access_key_id"],
                aws_secret_access_key = _MTURK_CONFIG["aws_secret_access_key"],
                region_name = _MTURK_CONFIG["region"],
                )
    elif host_str == 'actual':
        proceed = False
        if not forced:
            proceed_input = input("This will connect to actual Mturk \
                    interface and cost money. Continue? (y/n)")
            if proceed_input in ['y', 'Y']:
                proceed = True
        else:
            proceed = True

        if proceed:
            mtc = boto3.client('mturk')
        else:
            logger.error("Aborting")
            exit(1)

    logger.debug("Connected to "+host_str+" mturk endpoint")
    logger.debug(mtc.get_account_balance())
    return mtc

# TODO: This should all be moved into question_batch
def unit_as_token(question):
    """Returns the number of tokens in a @question with parameter doc_id"""
    return sum(map(len, api.get_document(question['doc_id'])['sentences']))

def unit_as_mention_pair(doc_id):
    """Returns the number of mention_pairs in a @question with parameter doc_id"""
    return len(api.get_evaluation_mention_pairs(doc_id))

def compute_units(batch, question):
    """Compute length for a @question using the @batch parameters"""
    if 'units_function' in batch:
        length = locals()[batch['units_function']](question)
    else:
        length = 1
    return length

def compute_estimated_time(batch, question):
    """Compute estimated time for a @question using the @batch parameters"""
    length = compute_units(batch, question)
    if 'unit_time' in batch:
        est_time = int(batch['unit_time']) * length
    else:
        #TODO: Change default
        est_time = 60
    return est_time

def compute_reward(batch, question):
    """Compute reward for a @question using the @batch parameters"""
    length = compute_units(batch, question)
    if 'unit_reward' in batch:
        reward = float("{0:.2f}".format(batch['unit_reward'] * length))
    else:
        reward = batch['doc_reward']
    return reward

def get_hit(conn, hit_id):
    return conn.get_hit(HITId=hit_id)['HIT']

def create_hit(conn,
               frame_height=None,
               title=None,
               description=None,
               max_assignments=None,
               duration=None,
               lifetime=None,
               reward=None,
               **kwargs):
    """
    Create a hit on mturk with @question in a @batch using @mturk_connection
    """
    logger.debug("Creating HIT(%s)", title)
    question = ExternalQuestion(MTURK_URL, frame_height)
    response = conn.create_hit(Question=question.get_as_xml(),
                               Title=title,
                               Description=description,
                               MaxAssignments=int(max_assignments),
                               AssignmentDurationInSeconds=int(duration),
                               LifetimeInSeconds=int(lifetime),
                               Reward=reward)
    logger.debug(["HIT created: ", response['HIT']['HITTypeId'], response['HIT']['HITId']])
    return response['HIT']['HITTypeId'], response['HIT']['HITId']

class HitMustBeReviewed(Exception):
    pass

def revoke_hit(conn, hit_id):
    """
    Revokes a HIT by first expiring it and then trying to delete it.
    This method will raise an RequestException if the HIT needs to be reviewed.
    """
    hit = get_hit(conn, hit_id)

    # Check if already disposed of.
    if hit["HITStatus"] == "Disposed":
        return False

    conn.update_expiration_for_hit(HITId=hit_id, ExpireAt=datetime.now())
    hit = get_hit(conn, hit_id)

    # Verify that the statis is Reviewable
    assert hit["HITStatus"] == "Reviewable" or hit["HITStatus"] == "Unassignable"
    assignments_inflight = hit['MaxAssignments'] - (hit['NumberOfAssignmentsAvailable'] + hit['NumberOfAssignmentsCompleted'] + hit['NumberOfAssignmentsPending'])
    if assignments_inflight > 0:
        logger.error("HIT must be reviewed")
        raise HitMustBeReviewed(hit_id)

    conn.delete_hit(HITId=hit_id)
    logger.info("Finished revoking mturk_hit %s", hit_id)
    return True

_TEST_PARAMS = {
    "title": "Find relations between people, companies and places",
    "description": "You'll need to pick which relationship is described between a single pair of people, places or organisations in a sentece.",
    "answer_field": "relations",
    "duration": "300",
    "frame_height": "1200",
    "max_assignments": "3",
    "doc_reward": "0.10",
    "lifetime": "86400",
    "reward": "0.10",
    }

def test_create_revoke_hit():
    """Test hit creation on the sandbox"""
    conn = connect('sandbox')
    _, hit_id = create_hit(conn, **_TEST_PARAMS)
    assert hit_id is not None

    # Get this HIT and ensure it has the desired properties.
    r = get_hit(conn, hit_id)
    assert r is not None
    assert r['Title'] == _TEST_PARAMS['title']
    assert r['Description'] == _TEST_PARAMS['description']
    assert r['Reward'] == _TEST_PARAMS['reward']
    assert r['HITStatus'] == 'Assignable'

    assert revoke_hit(conn, hit_id)
    r = get_hit(conn, hit_id)
    assert r is not None
    assert r['HITStatus'] == 'Disposed'

#TODO: DEPRECATED
def create_hit_for_question_batch(conn, batch, question):
    params = dict(batch)
    params['reward'] = compute_reward(batch, question)
    return create_hit(conn, **params)

def percentage_to_whole_range(size, range_begin=None, range_end=None):
    """Transforms fractional ranges to integer ranges scaled by size"""
    assert range_begin != None or range_end != None, \
            "At least one endpoint of the range needs to be specified"
    if range_begin is None:
        range_begin = 0
    if range_end is None:
        range_end = 1
    assert abs(range_begin) <= 1 and abs(range_end) <= 1, \
            "Both endpoints should have fractional limits"
    assert size >= 1, "size should be non-zero"

    i_begin = math.floor(range_begin*size)
    i_end = math.floor(range_end*size)
    i_begin, i_end = integer_to_whole_range(size, range_begin=i_begin, range_end=i_end)

    return i_begin, i_end

def integer_to_whole_range(size, range_begin=None, range_end=None):
    """Transforms integer ranges to whole number ranges"""
    assert range_begin != None or range_end != None, \
            "At least one endpoint of the range needs to be specified"
    assert size >= 1, "size should be non-zero"
    i_begin, i_end = range_begin, range_end
    if range_begin < 0:
        i_begin = size + i_begin
    if i_end < 0:
        i_end = size + i_end
    return i_begin, i_end

def test_transform_percentage_to_integer_range():
    """Test the above transformation"""
    with pytest.raises(AssertionError, message="Non-zero size expected"):
        percentage_to_whole_range(0)

    with pytest.raises(AssertionError, message="Expecting at least one range endpoint"):
        percentage_to_whole_range(10)

    with pytest.raises(AssertionError, message="Expecting at least one range endpoint"):
        percentage_to_whole_range(10, range_begin=None, range_end=None)

    with pytest.raises(AssertionError, message="Expecting range endpoints to be a positive or negative fraction"):
        percentage_to_whole_range(10, range_begin=0, range_end=2)

    with pytest.raises(AssertionError, message="Expecting range endpoints to be a positive or negative fraction"):
        percentage_to_whole_range(10, range_begin=None, range_end=-2)

    assert percentage_to_whole_range(10, range_begin=0.1, range_end=0.8) == (1, 8)
    assert percentage_to_whole_range(10, range_begin=-0.9, range_end=-0.2) == (1, 8)
    assert percentage_to_whole_range(13, range_begin=-0.9, range_end=-0.2) == (1, 10)

def create_batch(conn, question_batch_id, batch_type, questions):
    """
    Create a batch of HITs from @questions on MTurk using @conn.
    """
    assert batch_type in _MTURK_PARAMS, "Invalid batch type {}".format(batch_type)
    params = _MTURK_PARAMS[batch_type]

    with db.CONN:
        with db.CONN.cursor() as cur:
            db.execute("""
                INSERT INTO mturk_batch (params, description)
                VALUES (%(params)s, %(description)s) RETURNING id
                """, cur=cur, params=db.Json(params), description="")
            mturk_batch_id = cur.fetchone()[0]
            logger.debug("Creating new mturk_batch with id: %s", mturk_batch_id)

            for question in tqdm(questions, desc="Uploading HITs"):
                # TODO: Push these into question creation time.
                hit_params = dict(params)
                hit_params['reward'] = compute_reward(params, question.params)
                hit_params['units'] = compute_units(params, question.params)

                try:
                    hit_type_id, hit_id = create_hit(conn, **hit_params)
                    db.execute("""
                        INSERT INTO mturk_hit (id, batch_id, question_batch_id, question_id, type_id, price, units, state)
                        VALUES (%(hit_id)s, %(batch_id)s, %(question_batch_id)s,
                            %(question_id)s, %(hit_type_id)s, %(price)s, %(units)s, %(state)s)""",
                               cur=cur,
                               hit_id=hit_id,
                               batch_id=mturk_batch_id,
                               question_batch_id=question_batch_id,
                               question_id=question.id,
                               hit_type_id=hit_type_id,
                               price=hit_params['reward'],
                               units=hit_params['units'],
                               state="pending-annotation")
                    logger.debug("Added HIT %s", hit_id)
                    db.execute("""
                        UPDATE evaluation_question
                        SET state = %(state)s, message = %(message)s
                        WHERE id=%(question_id)s
                        """, cur=cur, state="pending-annotation", message="", question_id=question.id)

                except ClientError as e:
                    logger.exception(e)
                    db.execute("""
                        UPDATE evaluation_question
                        SET state = %(state)s, message = %(message)s
                        WHERE id=%(question_id)s
                        """, cur=cur, state="error", message=str(e), question_id=question.id)

    return mturk_batch_id

def revoke_batch(conn, batch_id):
    """
    Removes all HITs associated with an mturk_batch.
    """
    assert db.get("""SELECT EXISTS(SELECT * FROM mturk_batch WHERE id=%(batch_id)s)
        """, batch_id=batch_id).exists, "No such batch exists."
    hits = db.select("""
        SELECT id
        FROM mturk_hit
        WHERE batch_id = %(batch_id)s
          AND state <> 'revoked'
        """, batch_id=batch_id)
    for row in tqdm(hits, desc="Revoking batch"):
        # TODO: deal with assignments that are not yet paid and
        try:
            revoke_hit(conn, row.id)
            db.execute("""
                UPDATE mturk_hit
                SET state = %(state)s, message = %(message)s
                WHERE id=%(hit_id)s
                """, state="revoked", message='', hit_id=row.id)
            logger.info("Revoked HIT %s", row.id)
        except HitMustBeReviewed as e:
            logger.exception(e)
            continue
        except ClientError as e:
            logger.exception(e)
            db.execute("""
                UPDATE mturk_hit
                SET state = %(state)s, message = %(message)s
                WHERE id=%(hit_id)s
                """, state="error", message=str(e), hit_id=row.id)
            continue
    logger.info("Finished revoking mturk_batch %s", batch_id)

def test_create_revoke_batch():
    """Test batch creation on the sandbox"""
    # TODO: Hmm... this seems dubious. We need a better approach for database testing.
    from .params.db.remote_kbpo_test import _PARAMS
    db.CONN = db.connect(_PARAMS)

    conn = connect('sandbox')
    question_batch_id = 12
    question_batch = api.get_question_batch(question_batch_id)
    assert question_batch.batch_type == "selective_relations"
    questions = api.get_questions(question_batch_id)
    mturk_batch_id = create_batch(conn, question_batch_id, question_batch.batch_type, questions[:10])
    revoke_batch(conn, mturk_batch_id)

def mturk_batch_payments(conn, mturk_batch_id):
    rows = list(db.select("""
        SELECT id, verified, state, message
        FROM mturk_assignment
        WHERE batch_id = %(mturk_batch_id)s
        """, mturk_batch_id = mturk_batch_id))
    for row in rows:
        if row.verified == True and row.state == 'pending-payment':
            approve_assignment(conn, row.id)
            db.execute("UPDATE mturk_assignment SET state = 'approved' WHERE id = %(assignment_id)s", assignment_id = row.id)
        if row.verified == False:
            if row.state == 'verified-rejection':
                reject_assignment(conn, row.id, row.message)
                db.execute("UPDATE mturk_assignment SET state = 'rejected' WHERE id = %(assignment_id)s", assignment_id = row.id)
            elif row.state == 'pending-payment':
                pending_reject_assignment(row.id, row.message)
                db.execute("UPDATE mturk_assignment SET state = 'pending-rejection-verification' WHERE id = %(assignment_id)s", assignment_id = row.id)


class MTurkInvalidStatus(Exception):
    pass

def pending_reject_assignment(assignment_id, message = None):
    send_mail(
        subject='Assignment Pending Rejection',
        message="""Assignment_id %s is pending rejection. 
        To reject assignment, please change state to `verified-rejection`,
        To approve assignment, please change verified to True and state to `pending-payment`
        Message = %s
        """% (assignment_id, message),
        from_email='kbp-online-owners@lists.stanford.edu',
        recipient_list=['kbp-online-owners@lists.stanford.edu'],
    )

def reject_assignment(conn, assignment_id, message = None):
    assn = conn.get_assignment(AssignmentId = assignment_id)
    status = assn["Assignment"]["AssignmentStatus"]
    if status == "Approved":
        raise MTurkInvalidStatus("Assignment {} has already been approved!".format(assignment_id))
    elif status == "Rejected":
        return False
    elif status != "Submitted":
        raise MTurkInvalidStatus("Assignment should have status {}, but has status {}".format("Submitted", status))

    conn.reject_assignment(AssignmentId = assignment_id, message = message)
    return True

def approve_assignment(conn, assignment_id):
    assn = conn.get_assignment(AssignmentId = assignment_id)
    status = assn["Assignment"]["AssignmentStatus"]
    if status == "Approved":
        return False
    elif status == "Rejected":
        raise MTurkInvalidStatus("Assignment {} has already been rejected!".format(assignment_id))
    elif status != "Submitted":
        raise MTurkInvalidStatus("Assignment {} should have status {}, but has status {}".format(assignment_id, "Submitted", status))

    conn.approve_assignment(AssignmentId = assignment_id)
    return True

if __name__ == '__main__':
    pending_reject_assignment('test_assignment_id', 'Test_message')
