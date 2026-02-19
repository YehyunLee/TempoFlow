"""
AWS credential management and validation.
Handles interactive credential prompts and validation via STS.
"""

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from typing import Tuple, Optional
import getpass
import os


def prompt_credentials() -> Tuple[str, str, Optional[str], str, str]:
    """
    Interactively prompt for AWS credentials.
    
    Returns:
        Tuple of (access_key, secret_key, session_token, region, bucket_name)
    """
    print("\n" + "=" * 50)
    print("AWS Credentials Required")
    print("=" * 50)
    
    access_key = input("AWS Access Key ID: ").strip()
    secret_key = getpass.getpass("AWS Secret Access Key: ").strip()
    session_token_input = getpass.getpass("AWS Session Token (optional, required for ASIA temporary keys): ").strip()
    session_token = session_token_input if session_token_input else os.environ.get("AWS_SESSION_TOKEN")
    region = input("AWS Region (e.g., us-east-1): ").strip() or "us-east-1"
    bucket_name = input("S3 Bucket Name: ").strip()
    
    return access_key, secret_key, session_token, region, bucket_name


def validate_credentials(access_key: str, secret_key: str, session_token: Optional[str], region: str) -> Tuple[bool, str]:
    """
    Validate AWS credentials using STS GetCallerIdentity.
    
    Args:
        access_key: AWS Access Key ID
        secret_key: AWS Secret Access Key
        region: AWS Region
        
    Returns:
        Tuple of (is_valid, message)
    """
    try:
        client_kwargs = {
            'aws_access_key_id': access_key,
            'aws_secret_access_key': secret_key,
            'region_name': region,
        }
        if session_token:
            client_kwargs['aws_session_token'] = session_token

        sts_client = boto3.client('sts', **client_kwargs)
        
        response = sts_client.get_caller_identity()
        account_id = response.get('Account', 'Unknown')
        arn = response.get('Arn', 'Unknown')
        
        return True, f"Credentials valid. Account: {account_id}, ARN: {arn}"
        
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_msg = e.response.get('Error', {}).get('Message', str(e))
        return False, f"AWS Error ({error_code}): {error_msg}"
        
    except NoCredentialsError:
        return False, "No credentials provided"
        
    except Exception as e:
        return False, f"Validation failed: {str(e)}"


def validate_bucket_access(access_key: str, secret_key: str,
                           session_token: Optional[str],
                           region: str, bucket_name: str) -> Tuple[bool, str]:
    """
    Validate that the credentials have access to the specified S3 bucket.
    
    Args:
        access_key: AWS Access Key ID
        secret_key: AWS Secret Access Key
        region: AWS Region
        bucket_name: S3 bucket name to check
        
    Returns:
        Tuple of (has_access, message)
    """
    try:
        client_kwargs = {
            'aws_access_key_id': access_key,
            'aws_secret_access_key': secret_key,
            'region_name': region,
        }
        if session_token:
            client_kwargs['aws_session_token'] = session_token

        s3_client = boto3.client('s3', **client_kwargs)
        
        # Try to list bucket (limited to 1 object to minimize impact)
        s3_client.list_objects_v2(Bucket=bucket_name, MaxKeys=1)
        
        return True, f"Access to bucket '{bucket_name}' confirmed"
        
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        if error_code == 'NoSuchBucket':
            return False, f"Bucket '{bucket_name}' does not exist"
        elif error_code == 'AccessDenied':
            return False, f"Access denied to bucket '{bucket_name}'"
        else:
            return False, f"AWS Error ({error_code}): {e.response.get('Error', {}).get('Message', str(e))}"
            
    except Exception as e:
        return False, f"Bucket access check failed: {str(e)}"


def get_s3_client(access_key: str, secret_key: str, session_token: Optional[str], region: str):
    """
    Create and return a boto3 S3 client.
    
    Args:
        access_key: AWS Access Key ID
        secret_key: AWS Secret Access Key
        region: AWS Region
        
    Returns:
        boto3 S3 client
    """
    client_kwargs = {
        'aws_access_key_id': access_key,
        'aws_secret_access_key': secret_key,
        'region_name': region,
    }
    if session_token:
        client_kwargs['aws_session_token'] = session_token

    return boto3.client('s3', **client_kwargs)


def validate_all(access_key: str, secret_key: str,
                 session_token: Optional[str],
                 region: str, bucket_name: str) -> Tuple[bool, str]:
    """
    Validate credentials and bucket access in one call.
    
    Args:
        access_key: AWS Access Key ID
        secret_key: AWS Secret Access Key
        region: AWS Region
        bucket_name: S3 bucket name
        
    Returns:
        Tuple of (all_valid, message)
    """
    # First validate credentials
    creds_valid, creds_msg = validate_credentials(access_key, secret_key, session_token, region)
    if not creds_valid:
        return False, f"Credential validation failed: {creds_msg}"
    
    print(f"✓ {creds_msg}")
    
    # Then validate bucket access
    bucket_valid, bucket_msg = validate_bucket_access(access_key, secret_key, session_token, region, bucket_name)
    if not bucket_valid:
        return False, f"Bucket access failed: {bucket_msg}"
    
    print(f"✓ {bucket_msg}")
    
    return True, "All validations passed"
